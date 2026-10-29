import { scopeLabel } from "../../../../shared/orchestrator-owner.js";
import type { Card, OrchestratorRecord } from "../../../../shared/types.js";

export function orchestratorScopeText(
  records: readonly Pick<
    OrchestratorRecord,
    "name" | "role" | "kind" | "scope"
  >[],
  cards: readonly Pick<Card, "id" | "source" | "groupId">[],
): string | null {
  if (records.length === 0) return null;
  return records
    .map((record) => `${record.name}: ${scopeLabel(record, cards)}`)
    .join(" · ");
}
