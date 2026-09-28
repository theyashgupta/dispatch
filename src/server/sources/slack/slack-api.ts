import { RateLimited } from "../ticket.source.js";

export const SLACK_API_URL =
  process.env.DISPATCH_SLACK_API_URL ?? "https://slack.com/api";

const SLACK_TIMEOUT_MS = 30_000;

export const SLACK_READ_METHODS = Object.freeze([
  "auth.test",
  "users.conversations",
  "conversations.history",
  "conversations.replies",
  "conversations.info",
  "users.info",
] as const);

export type SlackReadMethod = (typeof SLACK_READ_METHODS)[number];

export type SlackParams = Record<string, string | number | boolean | undefined>;

export interface SlackResponse {
  ok: boolean;
  error?: string;
  [field: string]: unknown;
}

export interface SlackAuth {
  account: string;
  userId: string;
  teamUrl: string;
  botId?: string;
}

/**
 * Call one read-only Slack Web API method with a token and answer Slack's JSON body.
 *
 * @remarks The only Slack caller in the app: the method must be on the frozen read allowlist, so no
 * code path can reach a write method. The token rides the Authorization header, never the URL. A 429
 * raises RateLimited for the poller's back-off; any other non-200 throws a plain error.
 */
export async function slackGet(
  token: string,
  method: SlackReadMethod,
  params: SlackParams = {},
): Promise<SlackResponse> {
  if (!SLACK_READ_METHODS.includes(method)) {
    throw new Error(`not a Slack read method: ${String(method)}`);
  }
  const url = new URL(`${SLACK_API_URL}/${method}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "dispatch" },
    signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
  });
  if (res.status === 429) throw new RateLimited();
  if (res.status !== 200) throw new Error(`Slack answered HTTP ${res.status}`);
  return (await res.json()) as SlackResponse;
}

/** A Slack body field as a string, or "" when it is missing or not a string. */
export const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * Ask Slack who owns a token: the account label, user id and team URL, or Slack's rejection code.
 *
 * @remarks Only an ok false body is a rejection; every transport failure throws so the caller reads
 * it as unreachable and never tells the user a good token is bad.
 */
export async function slackAuthTest(
  token: string,
): Promise<SlackAuth | { rejected: string }> {
  const body = await slackGet(token, "auth.test");
  if (!body.ok) return { rejected: text(body.error) };
  const user = text(body.user);
  const team = text(body.team);
  const botId = text(body.bot_id);
  return {
    account: user && team ? `${user} @ ${team}` : user || team,
    userId: text(body.user_id),
    teamUrl: text(body.url),
    ...(botId ? { botId } : {}),
  };
}
