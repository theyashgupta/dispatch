import type { PrStateText } from "../../../../shared/pr-rows.js";
import type { PrTone } from "./pr-detail-state.js";

export const STATE_TONE: Record<PrStateText, PrTone> = {
  Draft: "neutral",
  "Review requested from me": "accent",
  "Changes requested": "warning",
  Approved: "success",
  Open: "neutral",
};

/**
 * The line the table shows when no row is left.
 *
 * @remarks
 * The no-remote line shows only once the repository list is known and empty, so a list that is
 * still loading or failed reads as an empty table. Rows that exist but fail the filters get their own line.
 */
export function prEmptyText(input: {
  repos: readonly string[] | null;
  hasRows: boolean;
}): string {
  if (input.hasRows) return "No pull requests match the filters.";
  return input.repos?.length === 0
    ? "No board repository has a GitHub remote."
    : "No open pull requests in the board repositories.";
}
