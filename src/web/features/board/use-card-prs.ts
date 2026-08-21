import type { Card, PrInfo } from "../../../shared/types.js";

const STATE_RANK: Record<"open" | "draft" | "merged" | "closed", number> = {
  open: 0,
  draft: 1,
  merged: 2,
  closed: 3,
};

function rankOf(pr: PrInfo): number {
  if (pr.isDraft) return STATE_RANK.draft;
  return STATE_RANK[pr.state];
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
