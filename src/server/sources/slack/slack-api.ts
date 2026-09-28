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
 * raises RateLimited for the poller's back-off; any other non-200 or a body that is not JSON throws
 * a plain error that never quotes the body.
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
  return (await res.json().catch((err: unknown) => {
    if (!(err instanceof SyntaxError)) throw err;
    throw new Error("Slack answered a body that is not JSON");
  })) as SlackResponse;
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

const PERMANENT_USER_CODES = new Set([
  "user_not_found",
  "user_not_visible",
  "missing_scope",
]);

/**
 * A user's display name, from the cache or users.info while the caller's lookup budget lasts.
 *
 * @remarks A refusal that will not change on retry caches the id as the name, so an unknown
 * author does not spend the lookup budget on every call.
 */
export async function slackUserName(
  token: string,
  userId: string,
  names: Map<string, string>,
  budget: { left: number },
): Promise<string> {
  const known = names.get(userId);
  if (known !== undefined) return known;
  if (budget.left <= 0) return userId;
  budget.left -= 1;
  const body = await slackGet(token, "users.info", { user: userId });
  if (!body.ok) {
    if (PERMANENT_USER_CODES.has(text(body.error))) names.set(userId, userId);
    return userId;
  }
  const user = body.user as Record<string, unknown> | undefined;
  const profile = user?.profile as Record<string, unknown> | undefined;
  const name =
    text(profile?.display_name) ||
    text(profile?.real_name) ||
    text(user?.name) ||
    userId;
  names.set(userId, name);
  return name;
}
