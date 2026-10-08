import type { SourceCursor } from "../../../shared/types.js";
import type { ActionDraft } from "./meeting-actions.js";

export interface MeetingGroup {
  meeting: string;
  meetingDate: string;
  drafts: ActionDraft[];
}

export const GRANOLA_UNAVAILABLE = "GRANOLA_UNAVAILABLE";

const HOUR_MS = 60 * 60 * 1000;
export const RUN_INTERVAL_MS = HOUR_MS;
const CURSOR_OVERLAP_MS = 30 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build the Granola round prompt for meetings between `since` and `until`.
 */
export function buildGranolaPrompt(since: Date, until: Date): string {
  return [
    "You are extracting the user's action items from their recent Granola meetings for Dispatch, a local task board.",
    `Use the Granola tools to list the meetings between ${since.toISOString()} and ${until.toISOString()} and read their notes.`,
    "List only the action items that belong to the user: commitments the user made, questions directed at the user, and decisions the user must act on. Skip items owned by other people.",
    "",
    "Output rules (follow exactly):",
    "- Output only repeated sections, at most 15 in total, with no preamble, no closing remarks and no code fence.",
    "- Each section starts with the literal line: ## Action item",
    "- Then the line key: <a short kebab-case slug of the action's subject, lowercase letters, digits and hyphens only, at most 48 characters; reuse the same key for the same action on every run>",
    "- Then the line title: <one plain-text sentence under 120 characters that starts with a verb>",
    "- Then the line meeting: <the meeting title exactly as Granola shows it>",
    "- Then the line date: <the meeting date as YYYY-MM-DD>",
    "- Then the line link: <the Granola URL of the meeting, or none>",
    "- Then a blank line and one sentence of context from the meeting.",
    "- If no meeting in that range holds an action item for the user, output exactly: NO_ACTION_ITEMS",
    `- If the Granola tools are not available, output exactly: ${GRANOLA_UNAVAILABLE}`,
    '- Never emit the literal text "DISPATCH_STATUS:" anywhere in your output.',
  ].join("\n");
}

/**
 * The time range one round reads.
 *
 * @remarks A recent success resumes 30 minutes before its poll so notes finished late are read
 * again; an older, missing or future cursor (the clock moved back) falls back to the whole window.
 */
export function roundSince(
  entry: SourceCursor | undefined,
  windowHours: number,
  now: Date,
): { since: Date; until: Date } {
  const windowStart = now.getTime() - windowHours * HOUR_MS;
  const polledAt = entry === undefined ? NaN : Date.parse(entry.polledAt);
  const recent = polledAt > windowStart && polledAt <= now.getTime();
  const since = recent ? polledAt - CURSOR_OVERLAP_MS : windowStart;
  return { since: new Date(since), until: now };
}

/**
 * Milliseconds until the next round is due, 0 when it is due now; the interval defaults to one hour.
 */
export function nextRunDelay(
  polledAt: string | undefined,
  now: Date,
  intervalMs = RUN_INTERVAL_MS,
): number {
  if (polledAt === undefined) return 0;
  const last = Date.parse(polledAt);
  if (Number.isNaN(last)) return 0;
  return Math.max(0, last + intervalMs - now.getTime());
}

/**
 * Group drafts by meeting and date so siblings stay within one meeting.
 *
 * @remarks A draft with no meeting line is dropped; one with no valid date takes `fallbackDate`.
 * Meetings group case- and space-insensitively, as their item ids do, and each group keeps the
 * first draft of a key, so two drafts can never map to one item id.
 */
export function groupByMeeting(
  drafts: readonly ActionDraft[],
  fallbackDate: string,
): MeetingGroup[] {
  const groups = new Map<string, MeetingGroup>();
  for (const draft of drafts) {
    if (draft.meeting === undefined) continue;
    const meetingDate =
      draft.date !== undefined && DATE_RE.test(draft.date)
        ? draft.date
        : fallbackDate;
    const id = `${meetingDate}\n${draft.meeting.trim().toLowerCase()}`;
    const group = groups.get(id) ?? {
      meeting: draft.meeting,
      meetingDate,
      drafts: [],
    };
    if (group.drafts.some((other) => other.key === draft.key)) continue;
    group.drafts.push(draft);
    groups.set(id, group);
  }
  return [...groups.values()];
}
