import type { Card } from "../../../shared/types.js";
import { teamCycleLabel } from "../../lib/linear-state.js";

interface TeamCycleTextProps {
  card: Card;
}

export function TeamCycleText({ card }: TeamCycleTextProps) {
  const label = teamCycleLabel(card.team, card.cycle);
  if (!label) return null;
  return (
    <span
      style={{
        flex: "0 1 auto",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: "var(--font-micro)",
        lineHeight: "var(--line-label)",
        color: "var(--text-muted)",
      }}
    >
      {label}
    </span>
  );
}
