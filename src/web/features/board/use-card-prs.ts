import type { Card, PrInfo } from "../../../shared/types.js";

const STATE_RANK: Record<"open" | "draft" | "merged" | "closed", number> = {
  open: 0,
  draft: 1,
  merged: 2,
  closed: 3,
};

/**
 * Sort rank for one PR, falling back to `closed` for a state outside the union.
 *
 * @remarks
 * The fallback is not dead: `board.db` holds rows written before `gh.ts` validated the token, and
 * an undefined rank makes every comparison `NaN`, which leaves the whole ordering
 * implementation-defined rather than merely misplacing one row.
 */
function rankOf(pr: PrInfo): number {
  if (pr.isDraft) return STATE_RANK.draft;
  return STATE_RANK[pr.state] ?? STATE_RANK.closed;
}

/**
 * Derives a card's full, deduped PR list from data already on the wire.
 *
 * @remarks
 * `card.prs` only ever mirrors the active session; sibling sessions' PRs already ride
 * `sessionSummaries[].prs` unread. Unioning client-side here means neither a server aggregate
 * nor a second fetch path is needed, both would re-probe `gh` for data the board already has.
 */
export function useCardPrs(card: Card): PrInfo[] {
  const seen = new Set<string>();
  const merged: PrInfo[] = [];
  for (const pr of [
    ...(card.prs ?? []),
    ...(card.sessionSummaries ?? []).flatMap((s) => s.prs ?? []),
  ]) {
    if (seen.has(pr.url)) continue;
    seen.add(pr.url);
    merged.push(pr);
  }
  return merged.sort((a, b) => {
    const rankDiff = rankOf(a) - rankOf(b);
    if (rankDiff !== 0) return rankDiff;
    return b.number - a.number;
  });
}
