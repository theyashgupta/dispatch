import { isHiddenCard } from "../../../../shared/hidden-card.js";
import {
  isGroupMember,
  kindLabel,
} from "../../../../shared/orchestrator-owner.js";
import type { Card, OrchestratorRecord } from "../../../../shared/types.js";

export interface OrchestratorOption {
  id: string;
  label: string;
}

export function orchestratorOptions(
  records: readonly OrchestratorRecord[],
): OrchestratorOption[] {
  return records.map((r) => ({
    id: r.id,
    label: `${r.name} (${kindLabel(r)})`,
  }));
}

/** True for an open card that is not a group member, on a board that has an extra orchestrator. */
export function assignableCard(
  card: Card,
  records: readonly OrchestratorRecord[],
): boolean {
  return (
    records.some((r) => r.role === "extra") &&
    card.column !== "done" &&
    !isHiddenCard(card) &&
    !isGroupMember(card)
  );
}
