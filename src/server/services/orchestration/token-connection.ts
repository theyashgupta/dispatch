import type {
  ItemSourceId,
  SourceConnection,
  SourceCredential,
} from "../../../shared/types.js";
import { isProviderCode } from "../../../shared/credential.js";
import {
  checkGithubToken,
  checkSentryToken,
  GitHubSsoError,
} from "../../adapters/source-gateway.js";
import {
  getOrchestrationConfig,
  setSourceEnabled,
} from "../infra/config-holder.js";
import { GITHUB_TOKEN_KEY, resolveGithubToken } from "./github-token.js";
import { resolveSentryToken, SENTRY_TOKEN_KEY } from "../infra/sentry-token.js";
import { checkSlackAuth } from "./slack.js";
import {
  resolveSlackToken,
  SLACK_BOT_TOKEN_KEY,
  SLACK_USER_TOKEN_KEY,
  slackKeyFor,
} from "../infra/slack-token.js";
import { clearValue, createKey, listKeys, setValue } from "../infra/vault.js";

export interface TokenSourceDef {
  id: ItemSourceId;
  vaultKey: string;
  purpose: string;
  resolve: () => Promise<SourceCredential | null>;
  check: (
    token: string,
  ) => Promise<{ account?: string } | { rejected: string } | null>;
  keyFor?: (token: string) => string | null;
  extraKeys?: readonly { name: string; purpose: string }[];
}

export const TOKEN_SOURCES: Record<ItemSourceId, TokenSourceDef> = {
  github: {
    id: "github",
    vaultKey: GITHUB_TOKEN_KEY,
    purpose:
      "GitHub token for the Pull Requests source (repo scope). Empty means Dispatch uses gh auth token.",
    resolve: resolveGithubToken,
    check: checkGithubToken,
  },
  sentry: {
    id: "sentry",
    vaultKey: SENTRY_TOKEN_KEY,
    purpose:
      "Sentry user auth token for the Errors source (org:read, event:read, event:write).",
    resolve: resolveSentryToken,
    check: checkSentryToken,
  },
  slack: {
    id: "slack",
    vaultKey: SLACK_USER_TOKEN_KEY,
    purpose:
      "Slack user token (xoxp) for the Slack source. Reads the picked channels, your DMs and your mentions. Preferred.",
    resolve: resolveSlackToken,
    check: checkSlackAuth,
    keyFor: slackKeyFor,
    extraKeys: [
      {
        name: SLACK_BOT_TOKEN_KEY,
        purpose:
          "Slack bot token (xoxb) for the Slack source, used only when SLACK_USER_TOKEN is empty. Sees only what the bot is in.",
      },
    ],
  },
};

type CheckFailure =
  | { error: "rejected"; providerError?: string }
  | { error: "unreachable" }
  | { error: "sso-required"; ssoUrl?: string };

export type TokenFailure =
  CheckFailure | { error: "no-credential" | "failed" | "superseded" };

type CheckOutcome =
  { ok: true; account?: string } | { ok: false; failure: CheckFailure };

/**
 * Ask the provider who owns a token, turning every failure into one of the connection error kinds.
 *
 * @remarks Only a genuine rejection reads as rejected; an SSO block keeps its authorization URL and
 * every other failure reads as unreachable, so an outage never tells the user their token is bad.
 */
async function checkToken(
  def: TokenSourceDef,
  token: string,
): Promise<CheckOutcome> {
  try {
    const owner = await def.check(token);
    if (!owner) return { ok: false, failure: { error: "rejected" } };
    if ("rejected" in owner) {
      return {
        ok: false,
        failure: isProviderCode(owner.rejected)
          ? { error: "rejected", providerError: owner.rejected }
          : { error: "rejected" },
      };
    }
    return owner.account ? { ok: true, account: owner.account } : { ok: true };
  } catch (err) {
    if (err instanceof GitHubSsoError) {
      return {
        ok: false,
        failure: err.ssoUrl
          ? { error: "sso-required", ssoUrl: err.ssoUrl }
          : { error: "sso-required" },
      };
    }
    return { ok: false, failure: { error: "unreachable" } };
  }
}

/** Report whether a token source has a credential, whether it polls, and who the credential is. */
export async function tokenConnection(
  def: TokenSourceDef,
): Promise<SourceConnection> {
  const enabled = getOrchestrationConfig()?.sources?.[def.id]?.enabled === true;
  const credential = await def.resolve();
  if (!credential) return { configured: false, connected: false, enabled };
  const checked = await checkToken(def, credential.token);
  const kind = credential.kind ? { tokenKind: credential.kind } : {};
  if (!checked.ok) {
    return {
      configured: true,
      connected: false,
      enabled,
      via: credential.via,
      ...kind,
      ...checked.failure,
    };
  }
  return {
    configured: true,
    connected: enabled,
    enabled,
    via: credential.via,
    ...kind,
    ...(checked.account ? { account: checked.account } : {}),
  };
}

/** Every Vault key a source can read its token from. */
function keysOf(def: TokenSourceDef): string[] {
  return [def.vaultKey, ...(def.extraKeys ?? []).map((k) => k.name)];
}

/**
 * Clear every named Vault key, answering whether all of them cleared.
 *
 * @remarks Every clear is attempted even after one fails, so one bad key never leaves the others
 * filled; a key that was never created answers not-found, which counts as cleared.
 */
async function clearKeys(keys: string[]): Promise<boolean> {
  const results = await Promise.allSettled(keys.map((key) => clearValue(key)));
  return results.every((r) => r.status === "fulfilled");
}

/** The purpose recorded for a source's Vault key when Dispatch creates it. */
function purposeOf(def: TokenSourceDef, key: string): string {
  return def.extraKeys?.find((k) => k.name === key)?.purpose ?? def.purpose;
}

/**
 * Turn on polling with the credential already present (a Vault value or the gh login).
 *
 * @remarks `stillCurrent` lets the route drop a connect that a disconnect overtook while the
 * credential was being resolved and checked.
 */
export async function connectTokenSource(
  def: TokenSourceDef,
  stillCurrent: () => boolean,
): Promise<
  | { ok: true; account?: string; via: SourceCredential["via"] }
  | { ok: false; failure: TokenFailure }
> {
  const credential = await def.resolve();
  if (!credential) return { ok: false, failure: { error: "no-credential" } };
  const checked = await checkToken(def, credential.token);
  if (!checked.ok) return checked;
  if (!stillCurrent()) return { ok: false, failure: { error: "superseded" } };
  try {
    setSourceEnabled(def.id, true);
  } catch {
    return { ok: false, failure: { error: "failed" } };
  }
  return { ...checked, via: credential.via };
}

/**
 * Store a pasted token in the Vault after the provider accepts it, then turn on polling.
 *
 * @remarks Test-before-persist: a rejected or unreachable token, or one whose prefix names no key,
 * never touches the Vault. Enabled is written before the token so a broken config stores nothing, and
 * `stillCurrent` is checked again after the store so a disconnect that landed meanwhile still wins.
 * The source's other keys are cleared last, so a stale token can never shadow the one just saved.
 */
export async function saveTokenSourceKey(
  def: TokenSourceDef,
  token: string,
  stillCurrent: () => boolean,
): Promise<
  { ok: true; account?: string } | { ok: false; failure: TokenFailure }
> {
  const vaultKey = def.keyFor ? def.keyFor(token) : def.vaultKey;
  if (!vaultKey) return { ok: false, failure: { error: "rejected" } };
  const checked = await checkToken(def, token);
  if (!checked.ok) return checked;
  if (!stillCurrent()) return { ok: false, failure: { error: "superseded" } };
  const wasEnabled =
    getOrchestrationConfig()?.sources?.[def.id]?.enabled === true;
  try {
    setSourceEnabled(def.id, true);
  } catch {
    return { ok: false, failure: { error: "failed" } };
  }
  let stored = false;
  try {
    const exists = (await listKeys()).some((k) => k.name === vaultKey);
    if (!stillCurrent()) return { ok: false, failure: { error: "superseded" } };
    const written = exists
      ? await setValue(vaultKey, token)
      : await createKey({
          name: vaultKey,
          purpose: purposeOf(def, vaultKey),
          value: token,
        });
    stored = written.ok;
  } catch {
    stored = false;
  }
  if (!stored) {
    if (stillCurrent()) restoreEnabled(def, wasEnabled);
    return { ok: false, failure: { error: "failed" } };
  }
  if (!stillCurrent()) {
    await clearValue(vaultKey).catch(() => undefined);
    return { ok: false, failure: { error: "superseded" } };
  }
  if (!(await clearKeys(keysOf(def).filter((key) => key !== vaultKey)))) {
    if (stillCurrent()) restoreEnabled(def, wasEnabled);
    return { ok: false, failure: { error: "failed" } };
  }
  return checked;
}

/** Put a source's enabled flag back after a failed save, keeping the failure the caller reports. */
function restoreEnabled(def: TokenSourceDef, enabled: boolean): void {
  try {
    setSourceEnabled(def.id, enabled);
  } catch {
    return;
  }
}

/** Stop polling and keep the stored token, so a later connect needs no paste. */
export function disableTokenSource(def: TokenSourceDef): boolean {
  try {
    setSourceEnabled(def.id, false);
    return true;
  } catch {
    return false;
  }
}

/** Forget every stored token of the source and stop polling; the key names stay registered. */
export async function disconnectTokenSource(
  def: TokenSourceDef,
): Promise<boolean> {
  try {
    setSourceEnabled(def.id, false);
    return await clearKeys(keysOf(def));
  } catch {
    return false;
  }
}
