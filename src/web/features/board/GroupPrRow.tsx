import type { Card } from "../../../shared/types.js";
import { PrBadge, PrOverflowChip, PR_CHIP_CAP } from "../badges/index.js";
import { cardPrs } from "./card-prs.js";

export function GroupPrRow({ card }: { card: Card }) {
  const prs = cardPrs(card);
  if (card.source !== "group" || prs.length === 0) return null;
  const showRepo = new Set(prs.map((pr) => pr.repo)).size > 1;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-xs)",
        flexWrap: "wrap",
      }}
    >
      {prs.slice(0, PR_CHIP_CAP).map((pr) => (
        <PrBadge key={pr.url} pr={pr} showRepo={showRepo} />
      ))}
      {prs.length > PR_CHIP_CAP && (
        <PrOverflowChip hidden={prs.length - PR_CHIP_CAP} />
      )}
    </div>
  );
}
