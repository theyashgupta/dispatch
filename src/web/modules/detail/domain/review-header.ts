import { prKey } from "../../../../shared/pr-rows.js";
import type { Card, Item, PrCheckState } from "../../../../shared/types.js";

export interface ReviewHeader {
  label: string;
  url: string;
  checks: PrCheckState | null;
  verdict: string | null;
}

export const REVIEW_CHECK_BADGE: Record<
  PrCheckState,
  { label: string; tone: "success" | "danger" | "warning" }
> = {
  pass: { label: "Checks passing", tone: "success" },
  fail: { label: "Checks failing", tone: "danger" },
  pending: { label: "Checks pending", tone: "warning" },
};

const VERDICT_PREFIX = "Review verdict: ";

function isCheckState(value: string | null | undefined): value is PrCheckState {
  return value === "pass" || value === "fail" || value === "pending";
}

function verdictIn(text: string | undefined): string | null {
  if (text == null) return null;
  const flat = text.replace(/\s+/g, " ");
  const at = flat.indexOf(VERDICT_PREFIX);
  if (at < 0) return null;
  const verdict = flat.slice(at + VERDICT_PREFIX.length).trim();
  return verdict === "" ? null : verdict;
}

/**
 * Build the pull request block shown in the header of a review card.
 *
 * @remarks
 * Checks come from the matching GitHub item first, then from `card.prs`. The verdict is the text
 * after "Review verdict: " in the last marker, else in the status reason.
 */
export function reviewHeader(card: Card, items: Item[]): ReviewHeader | null {
  const pr = card.reviewPr;
  if (pr == null) return null;
  const [owner = "", name = ""] = pr.repo.split("/");
  const itemId = prKey(owner, name, pr.number);
  const itemChecks = items.find((item) => item.id === itemId)?.meta.checks;
  const listed = card.prs?.find((entry) => entry.number === pr.number)?.ci;
  return {
    label: `PR #${pr.number}`,
    url: pr.url,
    checks: isCheckState(itemChecks)
      ? itemChecks
      : isCheckState(listed)
        ? listed
        : null,
    verdict: verdictIn(card.lastMarker) ?? verdictIn(card.statusReason),
  };
}
