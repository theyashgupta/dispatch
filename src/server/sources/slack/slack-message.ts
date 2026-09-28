import type { Item } from "../../../shared/types.js";

export interface SlackMessage {
  ts: string;
  user?: string;
  text?: string;
  subtype?: string;
  bot_id?: string;
  thread_ts?: string;
  reply_count?: number;
}

export type SlackConversation = "channel" | "im" | "mpim";

const KEPT_SUBTYPES = new Set(["thread_broadcast", "file_share"]);

const TITLE_MAX = 80;

const SNIPPET_MAX = 4000;

/**
 * Decide whether a Slack message is an ask to the user: a DM, a mention, or neither.
 *
 * @remarks A broadcast thread reply and a message with a file keep their mention, so those two
 * subtypes pass; joins, pins, topic changes and every other subtype are dropped (U2-05).
 */
export function classifyMessage(
  message: SlackMessage,
  conversation: SlackConversation,
  me: string,
): "dm" | "mention" | null {
  if (message.subtype && !KEPT_SUBTYPES.has(message.subtype)) return null;
  if (message.bot_id || !message.user || message.user === me) return null;
  if (conversation !== "channel") return "dm";
  const text = message.text ?? "";
  return text.includes(`<@${me}>`) || text.includes(`<@${me}|`)
    ? "mention"
    : null;
}

/** Turn one Slack markup token (the part between angle brackets) into readable text. */
function renderToken(
  token: string,
  names: ReadonlyMap<string, string>,
): string {
  const bar = token.indexOf("|");
  const target = bar === -1 ? token : token.slice(0, bar);
  const label = bar === -1 ? undefined : token.slice(bar + 1);
  if (target.startsWith("@")) {
    const id = target.slice(1);
    return `@${names.get(id) ?? id}`;
  }
  if (target.startsWith("#")) return `#${label ?? target.slice(1)}`;
  if (target.startsWith("!")) return label ?? `@${target.slice(1)}`;
  return label ?? target;
}

/** Render Slack message markup as plain text, naming users from the given map. */
export function renderSlackText(
  text: string,
  names: ReadonlyMap<string, string>,
): string {
  return text
    .replace(/<([^<>]+)>/g, (_, token: string) => renderToken(token, names))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The item title: who wrote it, where, and the first 80 characters of the rendered text. */
export function slackTitle(
  author: string,
  place: string,
  rendered: string,
): string {
  const chars = Array.from(rendered.replace(/\s+/g, " ").trim());
  const cut =
    chars.length > TITLE_MAX
      ? `${chars.slice(0, TITLE_MAX).join("")}…`
      : chars.join("");
  return `${author} in ${place}: ${cut}`;
}

/** The link to one message in Slack, built from the workspace URL auth.test answers. */
export function buildPermalink(
  teamUrl: string,
  channelId: string,
  ts: string,
): string {
  const base = teamUrl.endsWith("/") ? teamUrl : `${teamUrl}/`;
  return `${base}archives/${channelId}/p${ts.replace(".", "")}`;
}

/** Where a conversation is shown in titles and meta: "#name", "DM" or "group DM". */
export function slackPlace(
  conversation: SlackConversation,
  channelName: string,
): string {
  if (conversation === "im") return "DM";
  if (conversation === "mpim") return "group DM";
  return `#${channelName}`;
}

/**
 * Map one classified Slack message to an Inbox item.
 *
 * @remarks The id "slack:<channelId>:<ts>" is the dedupe key, so the same message polled twice is
 * one item (R-04, U2-08).
 */
export function slackItem(input: {
  message: SlackMessage;
  type: "dm" | "mention";
  channelId: string;
  channelName: string;
  conversation: SlackConversation;
  author: string;
  names: ReadonlyMap<string, string>;
  teamUrl: string;
}): Item {
  const { message, channelId, conversation, author } = input;
  const rendered = renderSlackText(message.text ?? "", input.names);
  const place = slackPlace(conversation, input.channelName);
  return {
    id: `slack:${channelId}:${message.ts}`,
    source: "slack",
    type: input.type,
    title: slackTitle(author, place, rendered),
    snippet: Array.from(rendered).slice(0, SNIPPET_MAX).join(""),
    url: buildPermalink(input.teamUrl, channelId, message.ts),
    createdAt: new Date(Number(message.ts) * 1000).toISOString(),
    priority: 75,
    state: "unread",
    meta: {
      channel: channelId,
      channelName: conversation === "channel" ? input.channelName : place,
      author,
      authorId: message.user ?? "",
      ts: message.ts,
      conversation,
      ...(message.thread_ts ? { threadTs: message.thread_ts } : {}),
      ...(message.reply_count !== undefined
        ? { replyCount: String(message.reply_count) }
        : {}),
    },
  };
}
