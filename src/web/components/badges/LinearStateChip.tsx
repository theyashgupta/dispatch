import type { Card } from "../../../shared/types.js";
import { stateChipColor } from "../../../shared/linear-state.js";
import { Badge } from "@/components/ui/badge";

interface LinearStateChipProps {
  card: Card;
}

export function LinearStateChip({ card }: LinearStateChipProps) {
  const state = card.linearState;
  if (!state) return null;
  return (
    <Badge
      tone="state"
      stateColor={stateChipColor(state)}
      className="border-0"
      title={`${state.type}: ${state.name}`}
    >
      <span className="min-w-0 truncate">{state.name}</span>
    </Badge>
  );
}
