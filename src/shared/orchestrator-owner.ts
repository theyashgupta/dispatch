import type { Card, OrchestratorRecord } from "./types.js";

export function mainOrchestrator<
  T extends Pick<OrchestratorRecord, "id" | "role" | "scope">,
>(records: readonly T[]): T | undefined {
  return records.find((r) => r.role === "main");
}

/**
 * Answer the orchestrator that owns a group card, or null on a board with no orchestrator.
 *
 * @remarks
 * The scopes are the one ownership source: the extra that lists the group, else the main. A stored
 * `ownerOrchestrator` is provenance only, so a group the user moved to the main follows the move.
 */
export function groupOwner(
  records: readonly Pick<OrchestratorRecord, "id" | "role" | "scope">[],
  group: Pick<Card, "id">,
): string | null {
  const extra = records.find(
    (r) => r.role === "extra" && r.scope.groupIds.includes(group.id),
  );
  if (extra) return extra.id;
  return mainOrchestrator(records)?.id ?? null;
}

/** Answer the orchestrator that owns any card: a group, a member of a group or a loose ticket. */
export function cardOwner(
  records: readonly Pick<OrchestratorRecord, "id" | "role" | "scope">[],
  card: Pick<Card, "id" | "source" | "groupId">,
  group: Pick<Card, "id"> | undefined,
): string | null {
  if (card.source === "group") return groupOwner(records, card);
  if (group) return groupOwner(records, group);
  const extra = records.find(
    (r) => r.role === "extra" && r.scope.ticketIds.includes(card.id),
  );
  if (extra) return extra.id;
  return mainOrchestrator(records)?.id ?? null;
}
