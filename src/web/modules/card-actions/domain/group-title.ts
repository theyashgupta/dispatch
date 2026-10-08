import type { Card } from "../../../../shared/types.js";

const PHRASE_CHAR_BUDGET = 56;

const TITLE_WITH_IDS_BUDGET = 80;

/**
 * Approximate rendered width of one code point in budget units.
 *
 * @remarks Astral-plane code points (emoji, CJK extensions) count as two Latin widths, so the budgets bound a visual width rather than a raw count.
 */
function pointWidth(point: string): number {
  return (point.codePointAt(0) ?? 0) > 0xffff ? 2 : 1;
}

/**
 * Truncate a phrase to `max` budget units and append an ellipsis when it had to cut.
 *
 * @remarks Iterates code points, never UTF-16 code units, because slicing a surrogate pair in half persists a lone surrogate into the card record.
 */
function truncatePhrase(phrase: string, max: number): string {
  const points = [...phrase];
  let total = 0;
  for (const p of points) total += pointWidth(p);
  if (total <= max) return phrase;

  const kept: string[] = [];
  let width = 0;
  for (const p of points) {
    const w = pointWidth(p);
    if (width + w > max - 1) break;
    kept.push(p);
    width += w;
  }
  return `${kept.join("").trimEnd()}…`;
}

/**
 * Return the shared Linear project name of the members, or the empty string when they do not share one.
 *
 * @remarks Never joins the identifiers, because the bracketed suffix already names every member. Collapses whitespace so a line break cannot make the displayed input value differ from the submitted one.
 */
function deterministicPhrase(members: Card[]): string {
  if (members.length === 0) return "";
  const firstProject = members[0].project;
  if (
    firstProject != null &&
    members.every((m) => m.project?.id === firstProject.id)
  ) {
    return firstProject.name.replace(/\s+/g, " ").trim();
  }
  return "";
}

/**
 * Append the bracketed count and identifier suffix to a phrase, which may be empty.
 *
 * @remarks Falls back to `phrase [N tickets]` once the full suffix passes `TITLE_WITH_IDS_BUDGET`. The phrase is cut at `PHRASE_CHAR_BUDGET` because it also bounds the fallback phrase, which no generation clamp touches.
 */
export function composeGroupTitle(phrase: string, members: Card[]): string {
  const bounded = truncatePhrase(phrase.trim(), PHRASE_CHAR_BUDGET);
  const lead = bounded === "" ? "" : `${bounded} `;
  const ids = members.map((m) => m.identifier).join(", ");
  const withIds = `${lead}[${members.length}: ${ids}]`;
  return withIds.length <= TITLE_WITH_IDS_BUDGET
    ? withIds
    : `${lead}[${members.length} tickets]`;
}

/**
 * Return the client-only default group title: the shared project name when every member has the same project, with the bracketed suffix.
 *
 * @remarks This is the permanent title whenever generation fails or never lands, so it has to stand on its own.
 */
export function deterministicGroupTitle(members: Card[]): string {
  return composeGroupTitle(deterministicPhrase(members), members);
}

export interface TitleCaret {
  selectionStart: number | null;
  selectionEnd: number | null;
  length: number;
}

/**
 * Tell whether a generated phrase may replace the title field value.
 *
 * @remarks `caret` is null when the input does not hold focus. Typing, a selection or a caret parked inside the text blocks the swap, but a caret at either edge does not, because a programmatic focus leaves it there. The caller must never gate Start or show a loading state on this result.
 * @see docs/ARCHITECTURE.md#group-card-titles
 */
export function shouldAcceptGeneratedPhrase(
  userHasEdited: boolean,
  caret: TitleCaret | null,
): boolean {
  if (userHasEdited) return false;
  if (caret === null) return true;
  const { selectionStart, selectionEnd, length } = caret;
  if (selectionStart === null || selectionEnd === null) return true;
  if (selectionStart !== selectionEnd) return false;
  return selectionStart === 0 || selectionStart === length;
}
