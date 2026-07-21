import type { Card } from "../../../shared/types.js";

export function LinearStateBadge({ card }: { card: Card }) {
  if (card.linearState?.type !== "started") return null;
  return (
    <span
      style={{
        flex: "0 0 auto",
        fontSize: "var(--font-label)",
        fontWeight: "var(--weight-semibold)",
        lineHeight: "var(--line-label)",
        color: "var(--text-muted)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "0 var(--space-xs)",
        whiteSpace: "nowrap",
      }}
    >
      {card.linearState.name}
    </span>
  );
}
