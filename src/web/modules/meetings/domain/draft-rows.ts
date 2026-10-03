export interface MeetingDraft {
  key: string;
  title: string;
  description: string;
}

export interface ReviewRow {
  draft: MeetingDraft;
  checked: boolean;
  title: string;
}

export const NOTES_MAX = 100_000;
export const MEETING_MAX = 200;
export const ME_MAX = 100;
export const TITLE_MAX = 300;
export const MARKER_ERROR = "content contains the DISPATCH_STATUS marker";

/** Turn drafted items into review rows, every row checked and titled as drafted. */
export function toReviewRows(drafts: readonly MeetingDraft[]): ReviewRow[] {
  return drafts.map((draft) => ({ draft, checked: true, title: draft.title }));
}

/**
 * Return the drafts the create request sends: the checked rows only, each with its edited title trimmed.
 *
 * @remarks An unchecked row never reaches the request, so the server never creates an item the user turned off.
 */
export function checkedDrafts(rows: readonly ReviewRow[]): MeetingDraft[] {
  return rows
    .filter((row) => row.checked)
    .map((row) => ({ ...row.draft, title: row.title.trim() }));
}

/** Tell whether a checked row has a blank title, which blocks the create. */
export function hasBlankCheckedTitle(rows: readonly ReviewRow[]): boolean {
  return rows.some((row) => row.checked && row.title.trim() === "");
}

/** Return the copy for a failed draft: the busy, invalid-input or generic message. */
export function draftErrorCopy(error: string | null): string {
  if (error === "generate-in-progress") {
    return "Another draft is still running or stopping. Try again in a few seconds.";
  }
  if (error?.startsWith("invalid-") === true) {
    return "Check the meeting name and notes, then try again.";
  }
  return "Couldn't draft action items. Try again.";
}

/** Return the copy for a failed create: the reserved marker message or the generic message. */
export function createErrorCopy(error: string | null): string {
  return error === MARKER_ERROR
    ? "An item contains the reserved DISPATCH_STATUS marker. Edit its title."
    : "Couldn't create the items. Try again.";
}
