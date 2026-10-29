import { isHiddenCard } from "./hidden-card.js";
import type { Card, OrchestratorKind, OrchestratorRecord } from "./types.js";

/** Answer the scope kind of a record: the stored kind, else the kind of its role. */
export function orchestratorKind(
  record: Pick<OrchestratorRecord, "role" | "kind">,
): OrchestratorKind {
  return record.kind ?? (record.role === "main" ? "board" : "feature");
}

export function kindLabel(
  record: Pick<OrchestratorRecord, "role" | "kind">,
): "Board" | "Feature" {
  return orchestratorKind(record) === "board" ? "Board" : "Feature";
}

/**
 * Answer the scope label of a record: "Board", or "Feature, N cards".
 *
 * @remarks
 * The scope lists keep stale ids, such as a ticket that later joined a group or a group that was unwound. So the count comes from the cards that the scope lists and that still own work: no group members and no hidden cards.
 */
export function scopeLabel(
  record: Pick<OrchestratorRecord, "role" | "kind" | "scope">,
  cards: readonly Pick<Card, "id" | "source" | "groupId">[],
): string {
  const label = kindLabel(record);
  if (label === "Board") return label;
  const { groupIds, ticketIds } = record.scope;
  const count = cards.filter(
    (card) =>
      (groupIds.includes(card.id) || ticketIds.includes(card.id)) &&
      !isGroupMember(card) &&
      !isHiddenCard(card),
  ).length;
  return `${label}, ${count} ${count === 1 ? "card" : "cards"}`;
}

/** True for a member card of a group, which follows its group and has no owner of its own. */
export function isGroupMember(card: Pick<Card, "source" | "groupId">): boolean {
  return card.source !== "group" && Boolean(card.groupId);
}

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
