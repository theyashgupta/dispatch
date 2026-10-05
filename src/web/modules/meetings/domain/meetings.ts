import type { Item } from "../../../../shared/types.js";

/** Return the notice shown after the meeting notes flow creates or updates Inbox items. */
export function meetingNotice(result: {
  created: number;
  updated: number;
  notesSaved?: boolean;
}): string {
  const items = (n: number) => (n === 1 ? "1 item" : `${n} items`);
  const created = `Created ${items(result.created)} in the Inbox.`;
  const counts =
    result.created === 0
      ? `Updated ${items(result.updated)} in the Inbox.`
      : result.updated > 0
        ? `${created} Updated ${result.updated}.`
        : created;
  return result.notesSaved === false
    ? `${counts} The notes weren't saved.`
    : counts;
}

export interface MeetingGroup {
  id: string;
  meeting: string;
  meetingDate: string;
  feed: "granola" | "paste";
  items: Item[];
}

/**
 * Group meeting items by `meta.meetingId`, newest `meetingDate` first.
 *
 * @remarks An item with no meetingId forms its own single-item group keyed by its item id.
 */
export function meetingGroups(items: readonly Item[]): MeetingGroup[] {
  const groups = new Map<string, MeetingGroup>();
  for (const item of items) {
    const key = item.meta.meetingId ?? item.id;
    let group = groups.get(key);
    if (group == null) {
      group = {
        id: key,
        meeting: item.meta.meeting ?? item.title,
        meetingDate: item.meta.meetingDate ?? "",
        feed: item.meta.feed === "granola" ? "granola" : "paste",
        items: [],
      };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  for (const group of groups.values()) {
    group.items.sort((a, b) => {
      const byCreated = a.createdAt.localeCompare(b.createdAt);
      return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id);
    });
  }
  return [...groups.values()].sort((a, b) => {
    const byDate = b.meetingDate.localeCompare(a.meetingDate);
    return byDate !== 0 ? byDate : a.meeting.localeCompare(b.meeting);
  });
}

/**
 * Return the first non-blank line of a meeting item's snippet body, for the list row.
 *
 * @remarks Line 1 is the "From <meeting> on <date>." header the server writes, which the group
 * header already shows.
 */
export function snippetBodyLine(snippet: string): string {
  const lines = snippet.split("\n").slice(1);
  return lines.find((line) => line.trim() !== "")?.trim() ?? "";
}

/** Parse `meta.siblings` as a JSON array of strings, dropping non-strings and keeping at most 14. */
export function parseSiblings(raw: string | undefined): string[] {
  if (raw == null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, 14);
}
