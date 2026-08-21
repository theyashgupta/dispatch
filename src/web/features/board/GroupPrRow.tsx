import type { Card } from "../../../shared/types.js";
import { PrBadge } from "../badges/index.js";
import { useCardPrs } from "./use-card-prs.js";

const chipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  borderRadius: "var(--radius-sm)",
  padding: "0 var(--space-xs)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
};

export function GroupPrRow({ card }: { card: Card }) {
  const cardPrs = useCardPrs(card);
  if (card.source !== "group" || cardPrs.length === 0) return null;
  const showRepo = new Set(cardPrs.map((pr) => pr.repo)).size > 1;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-xs)",
        flexWrap: "wrap",
      }}
    >
      {cardPrs.slice(0, 3).map((pr) => (
        <PrBadge key={pr.url} pr={pr} showRepo={showRepo} />
      ))}
      {cardPrs.length > 3 && (
        <span
          style={{
            ...chipStyle,
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
          }}
          title={`${cardPrs.length - 3} more pull request${cardPrs.length - 3 === 1 ? "" : "s"}`}
          aria-label={`${cardPrs.length - 3} more pull request${cardPrs.length - 3 === 1 ? "" : "s"}`}
        >
          {`+${cardPrs.length - 3}`}
        </span>
      )}
    </div>
  );
}
