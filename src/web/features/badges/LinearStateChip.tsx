import type { Card } from "../../../shared/types.js";
import { stateChipColor } from "../../lib/linear-state.js";
import { StateChip } from "../../primitives/StateChip.js";

interface LinearStateChipProps {
  card: Card;
}

export function LinearStateChip({ card }: LinearStateChipProps) {
  const state = card.linearState;
  if (!state) return null;
  return (
    <StateChip
      name={state.name}
      color={stateChipColor(state)}
      title={`${state.type}: ${state.name}`}
    />
  );
}
