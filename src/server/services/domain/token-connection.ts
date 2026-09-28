import type {
  ItemSourceId,
  SourceConnection,
  SourceCredential,
} from "../../../shared/types.js";
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
import { resolveSentryToken, SENTRY_TOKEN_KEY } from "./sentry-token.js";
import { clearValue, createKey, listKeys, setValue } from "./vault.js";

export interface TokenSourceDef {
  id: ItemSourceId;
  vaultKey: string;
  purpose: string;
  resolve: () => Promise<SourceCredential | null>;
  check: (token: string) => Promise<{ account?: string } | null>;
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
};

type CheckFailure =
  | { error: "rejected" | "unreachable" }
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
  if (!checked.ok) {
    return {
      configured: true,
      connected: false,
      enabled,
      via: credential.via,
      ...checked.failure,
    };
  }
  return {
    configured: true,
    connected: enabled,
    enabled,
    via: credential.via,
    ...(checked.account ? { account: checked.account } : {}),
  };
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
 * @remarks Test-before-persist: a rejected or unreachable token never touches the Vault. Enabled is
 * written before the token so a broken config stores nothing, and `stillCurrent` is checked again
 * after the store so a disconnect that landed meanwhile still wins.
 */
export async function saveTokenSourceKey(
  def: TokenSourceDef,
  token: string,
  stillCurrent: () => boolean,
): Promise<
  { ok: true; account?: string } | { ok: false; failure: TokenFailure }
> {
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
    const exists = (await listKeys()).some((k) => k.name === def.vaultKey);
    if (!stillCurrent()) return { ok: false, failure: { error: "superseded" } };
    const written = exists
      ? await setValue(def.vaultKey, token)
      : await createKey({
          name: def.vaultKey,
          purpose: def.purpose,
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
    await clearValue(def.vaultKey).catch(() => undefined);
    return { ok: false, failure: { error: "superseded" } };
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

/** Forget the stored token and stop polling; the key name stays registered for a later fill. */
export async function disconnectTokenSource(
  def: TokenSourceDef,
): Promise<boolean> {
  try {
    setSourceEnabled(def.id, false);
    await clearValue(def.vaultKey);
    return true;
  } catch {
    return false;
  }
}
