import type { Card } from "../../../../shared/types.js";
import { cardPrs } from "../../../../shared/card-prs.js";
import { PrBadge } from "@/components/badges/PrBadge";
import {
  PrOverflowChip,
  PR_CHIP_CAP,
} from "@/components/badges/PrOverflowChip";

export function GroupPrRow({ card }: { card: Card }) {
  const prs = cardPrs(card);
  if (card.source !== "group" || prs.length === 0) return null;
  const showRepo = new Set(prs.map((pr) => pr.repo)).size > 1;
  return (
    <div className="flex flex-wrap items-center gap-(--space-xs)">
      {prs.slice(0, PR_CHIP_CAP).map((pr) => (
        <PrBadge key={pr.url} pr={pr} showRepo={showRepo} />
      ))}
      {prs.length > PR_CHIP_CAP && (
        <PrOverflowChip hidden={prs.length - PR_CHIP_CAP} />
      )}
    </div>
  );
}
