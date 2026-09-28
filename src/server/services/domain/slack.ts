import type {
  SlackChannel,
  SlackChannelOption,
} from "../../../shared/types.js";
import {
  checkSlackToken,
  listSlackChannels,
  parseSlackChannelRef,
  slackChannelInfo,
} from "../../adapters/source-gateway.js";
import { getOrchestrationConfig } from "../infra/config-holder.js";
import { resolveSlackToken } from "./slack-token.js";

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
async function setupToken(): Promise<string | SlackRefusal> {
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
