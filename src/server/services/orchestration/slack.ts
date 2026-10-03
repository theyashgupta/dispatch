import { createHash } from "node:crypto";
import type {
  SlackChannel,
  SlackChannelOption,
  SlackThread,
} from "../../../shared/types.js";
import {
  checkSlackToken,
  fetchSlackThread,
  listSlackChannels,
  parseSlackChannelRef,
  slackChannelInfo,
  SlackThreadCache,
  SourceRateLimited,
} from "../../adapters/source-gateway.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { getOrchestrationConfig } from "../infra/config-holder.js";
import { resolveSlackToken } from "../infra/slack-token.js";

const NAME_FALLBACK_CODES = new Set([
  "missing_scope",
  "channel_not_found",
  "not_in_channel",
]);

const AUTH_CODES = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
  "no_permission",
  "org_login_required",
  "ekm_access_denied",
  "team_access_not_granted",
]);

type SlackCodeKind = "rejected" | "missing-scope" | "unreachable";

export type SlackRefusal =
  | { error: "disabled" | "no-credential" | "not-a-channel" }
  | { error: SlackCodeKind; code: string };

/**
 * Ask Slack who owns a token, reading only the token codes as a rejection.
 *
 * @remarks Slack answers ok false for its own incidents too (service_unavailable, fatal_error), so
 * any other code throws and the connection reads as unreachable instead of a bad token.
 */
export async function checkSlackAuth(
  token: string,
): Promise<{ account?: string } | { rejected: string }> {
  const owner = await checkSlackToken(token);
  if ("rejected" in owner && !AUTH_CODES.has(owner.rejected)) {
    throw new Error("Slack could not check the token");
  }
  return owner;
}

/**
 * Classify a Slack error code as a token rejection, a missing scope, or anything else.
 *
 * @remarks Only the token codes read as rejected, so a Slack outage or rate limit never tells the
 * user their token is bad.
 */
function classifySlackCode(code: string): SlackRefusal {
  if (AUTH_CODES.has(code)) return { error: "rejected", code };
  if (code === "missing_scope") return { error: "missing-scope", code };
  return { error: "unreachable", code };
}

/**
 * Resolve the Slack token for a setup call, refusing while the Slack switch is off.
 *
 * @remarks Connect is the user's consent to talk to Slack, so a token filled only on the Vault page
 * is not enough.
 */
async function setupToken(): Promise<
  string | { error: "disabled" | "no-credential" }
> {
  if (getOrchestrationConfig()?.sources?.slack?.enabled !== true) {
    return { error: "disabled" };
  }
  const credential = await resolveSlackToken();
  return credential ? credential.token : { error: "no-credential" };
}

/** List the channels the Slack user can pick, or the reason Dispatch did not ask Slack. */
export async function slackChannelOptions(): Promise<
  { channels: SlackChannelOption[]; truncated: boolean } | SlackRefusal
> {
  const auth = await setupToken();
  if (typeof auth !== "string") return auth;
  const list = await listSlackChannels(auth);
  return list.ok
    ? { channels: list.channels, truncated: list.truncated }
    : classifySlackCode(list.code);
}

/**
 * Turn a pasted channel link or id into a picked channel entry.
 *
 * @remarks When Slack refuses to name the channel, the id stands in as the name and Slack's code
 * rides along, so a workspace that restricts conversations.info can still pick the channel.
 */
export async function resolveSlackChannel(
  input: string,
): Promise<(SlackChannel & { providerError?: string }) | SlackRefusal> {
  const id = parseSlackChannelRef(input);
  if (!id) return { error: "not-a-channel" };
  const auth = await setupToken();
  if (typeof auth !== "string") return auth;
  const info = await slackChannelInfo(auth, id);
  if (info.ok) return { id, name: info.name };
  return NAME_FALLBACK_CODES.has(info.code)
    ? { id, name: id, providerError: info.code }
    : classifySlackCode(info.code);
}

const THREAD_MISSING_CODES = new Set(["thread_not_found", "channel_not_found"]);

export type SlackThreadRefusal =
  | {
      error:
        | "not-found"
        | "disabled"
        | "no-credential"
        | "rate-limited"
        | "unreachable";
    }
  | { error: "rejected"; code: string };

const threadCache = new SlackThreadCache();

const namesByAccount = new Map<string, Map<string, string>>();

/**
 * Load the thread behind a Slack item, from the 10 minute cache or conversations.replies.
 *
 * @remarks The item is checked before the switch and the token, so a missing, non-Slack or
 * thread-less item answers not-found without any Slack call. The thread cache key and the name
 * cache carry a hash of the token, so nothing loaded under one Slack account reaches another.
 */
export async function slackThread(
  itemId: string,
): Promise<SlackThread | SlackThreadRefusal> {
  const item = store.getItem(itemId);
  const channel = item?.meta.channel;
  const threadTs = item?.meta.threadTs;
  if (!item || item.source !== "slack" || !channel || !threadTs) {
    return { error: "not-found" };
  }
  const auth = await setupToken();
  if (typeof auth !== "string") return auth;
  const account = createHash("sha256").update(auth).digest("hex").slice(0, 16);
  const key = `${account}:${channel}:${threadTs}`;
  const cached = threadCache.get(key);
  if (cached) return cached;
  let result: Awaited<ReturnType<typeof fetchSlackThread>>;
  try {
    let names = namesByAccount.get(account);
    if (!names) {
      names = new Map();
      namesByAccount.set(account, names);
    }
    result = await fetchSlackThread(auth, channel, threadTs, names);
  } catch (err) {
    if (err instanceof SourceRateLimited) return { error: "rate-limited" };
    return { error: "unreachable" };
  }
  if (!result.ok) {
    if (AUTH_CODES.has(result.code)) {
      return { error: "rejected", code: result.code };
    }
    if (THREAD_MISSING_CODES.has(result.code)) return { error: "not-found" };
    return { error: "unreachable" };
  }
  const thread = { messages: result.messages, truncated: result.truncated };
  threadCache.set(key, thread);
  return thread;
}
