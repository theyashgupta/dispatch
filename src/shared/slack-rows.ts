import type { Item } from "./types.js";

export interface SlackPill {
  label: string;
  tone: "neutral" | "accent";
}

export interface SlackGroup {
  key: string;
  label: string;
  rows: SlackRow[];
}

export interface SlackRow {
  id: string;
  title: string;
  snippet: string;
  time: string;
  unread: boolean;
  url?: string;
  item: Item;
}

const TYPE_PILL: Record<string, string> = { dm: "DM", mention: "Mention" };

/** Return the rows for the Slack items that are not done, newest first. */
export function slackRows(items: readonly Item[]): SlackRow[] {
  return items
    .filter((item) => item.source === "slack" && item.state !== "done")
    .map((item) => ({
      id: item.id,
      title: item.title,
      snippet: item.snippet,
      time: item.createdAt,
      unread: item.state === "unread",
      url: item.url,
      item,
    }))
    .sort((a, b) => b.time.localeCompare(a.time) || a.id.localeCompare(b.id));
}

/**
 * Return the author name to show for a Slack item.
 *
 * @remarks Whitespace runs collapse to one space and bidi or invisible format characters are dropped,
 * so a hostile name stays on one line and reads as what it is.
 */
export function slackAuthor(item: Item): string {
  const name = (item.meta.author ?? "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return name || "unknown";
}

/** Return the pills a Slack item shows: who wrote it, DM or Mention, and Thread when it has replies. */
export function slackPills(item: Item): SlackPill[] {
  const pills: SlackPill[] = [
    { label: `From ${slackAuthor(item)}`, tone: "neutral" },
  ];
  if (Object.hasOwn(TYPE_PILL, item.type)) {
    pills.push({ label: TYPE_PILL[item.type], tone: "accent" });
  }
  if (Number(item.meta.replyCount) > 0) {
    pills.push({ label: "Thread", tone: "neutral" });
  }
  return pills;
}

/**
 * Group Slack rows by conversation, in the order the rows arrive.
 *
 * @remarks Every DM and group DM shares one "Direct messages" group; a channel groups by its id so a
 * renamed channel does not split.
 */
export function groupSlackRows(rows: readonly SlackRow[]): SlackGroup[] {
  const groups = new Map<string, SlackGroup>();
  for (const row of rows) {
    const { meta } = row.item;
    const channel = meta.conversation === "channel";
    const key = channel ? `channel:${meta.channel}` : "dm";
    const label = channel ? `#${meta.channelName}` : "Direct messages";
    const group = groups.get(key) ?? { key, label, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Return where a Slack message was posted: a DM, a group DM or a channel. */
export function slackPlace(
  conversation: string | undefined,
  channelName: string,
): string {
  if (conversation === "im") return "in a DM";
  if (conversation === "mpim") return "in a group DM";
  return `in #${channelName}`;
}
