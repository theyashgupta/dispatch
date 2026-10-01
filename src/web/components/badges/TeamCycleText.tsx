import type { Card } from "../../../shared/types.js";
import { teamCycleLabel } from "../../../shared/linear-state.js";

interface TeamCycleTextProps {
  card: Card;
}

export function TeamCycleText({ card }: TeamCycleTextProps) {
  const label = teamCycleLabel(card.team, card.cycle);
  if (!label) return null;
  return (
    <span className="min-w-0 shrink truncate text-xs text-muted-foreground">
      {label}
    </span>
  );
}
