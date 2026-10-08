import { isHiddenCard } from "../../../../shared/hidden-card.js";
import type {
  Card,
  OrchestratorPolicyOverride,
  OrchestratorRecord,
  OrchestratorScope,
} from "../../../../shared/types.js";
import {
  ROADMAP_APPROVAL_OPTIONS,
  SHIP_RIGHTS_OPTIONS,
  USAGE_LIMIT_OPTIONS,
} from "./policy-form.js";

export type OwnerRecord = Pick<
  OrchestratorRecord,
  "id" | "name" | "role" | "scope" | "policyOverride"
>;

export interface ScopeRow {
  id: string;
  kind: "group" | "ticket";
  label: string;
  ownedBy: string | null;
}

export interface ScopeStep {
  id: string;
  scope: OrchestratorScope;
  restore: OrchestratorScope;
}

export interface MovePlan {
  steps: ScopeStep[];
  blocked: string | null;
}

export const MAIN_SCOPE_TEXT = "Each group that no extra owns";

export const NEEDS_SCOPE_HINT =
  "An extra orchestrator needs at least one group or ticket.";

function isOpen(card: Card): boolean {
  return card.column !== "done" && !isHiddenCard(card);
}

function ownerOf(
  id: string,
  records: readonly OwnerRecord[],
  exceptId: string | null,
): OwnerRecord | undefined {
  return records.find(
    (r) =>
      r.role === "extra" &&
      r.id !== exceptId &&
      (r.scope.groupIds.includes(id) || r.scope.ticketIds.includes(id)),
  );
}

/**
 * List the open groups and tickets of the board as scope checkboxes.
 *
 * @remarks
 * A group or ticket that another extra owns is marked with that owner, because each one has exactly one owner. A ticket inside a group is left out, since its group is the unit of ownership.
 */
export function scopeRows(
  cards: readonly Card[],
  records: readonly OwnerRecord[],
  selfId: string | null,
): ScopeRow[] {
  return cards
    .filter((card) => isOpen(card) && card.groupId === undefined)
    .map((card) => ({
      id: card.id,
      kind: card.source === "group" ? ("group" as const) : ("ticket" as const),
      label: `${card.identifier} ${card.title}`,
      ownedBy: ownerOf(card.id, records, selfId)?.name ?? null,
    }));
}

/** Split the picked row ids into the scope of a record. */
export function scopeOf(
  picked: readonly string[],
  rows: readonly ScopeRow[],
): OrchestratorScope {
  const kind = new Map(rows.map((r) => [r.id, r.kind]));
  return {
    groupIds: picked.filter((id) => kind.get(id) === "group"),
    ticketIds: picked.filter((id) => kind.get(id) === "ticket"),
  };
}

/**
 * Choose the id and the name of the next extra orchestrator.
 *
 * @remarks
 * The contract form has no name field, so the name is "Extra orchestrator N" and the id is `extra-N`, where N is the smallest number that no record uses.
 */
export function nextExtra(records: readonly OwnerRecord[]): {
  id: string;
  name: string;
} {
  let n = 1;
  while (records.some((r) => r.id === `extra-${n}`)) n++;
  return { id: `extra-${n}`, name: `Extra orchestrator ${n}` };
}

function unownedOpenGroups(
  cards: readonly Card[],
  records: readonly OwnerRecord[],
): Card[] {
  return cards.filter(
    (c) =>
      c.source === "group" &&
      isOpen(c) &&
      ownerOf(c.id, records, null) === undefined,
  );
}

function scopeSize(scope: OrchestratorScope): number {
  return scope.groupIds.length + scope.ticketIds.length;
}

/** The groups that a move can take from a record: its group scope for an extra, the ungiven open groups for the main. */
export function movableGroups(
  source: OwnerRecord,
  records: readonly OwnerRecord[],
  cards: readonly Card[],
): { id: string; label: string }[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const ids =
    source.role === "extra"
      ? source.scope.groupIds
      : unownedOpenGroups(cards, records).map((c) => c.id);
  return ids.map((id) => {
    const card = byId.get(id);
    return { id, label: card ? `${card.identifier} ${card.title}` : id };
  });
}

/**
 * Plan the PATCH calls that move groups from one orchestrator to another.
 *
 * @remarks
 * The source step comes first, because the server refuses a group that two extras both list. The main has no scope, so a move to the main only removes the groups from the extra, and a move from the main only adds them to the target. A move that would empty the scope of an extra is blocked.
 */
export function movePlan(
  records: readonly OwnerRecord[],
  sourceId: string,
  targetId: string,
  groupIds: readonly string[],
): MovePlan {
  const source = records.find((r) => r.id === sourceId);
  const target = records.find((r) => r.id === targetId);
  const steps: ScopeStep[] = [];
  if (!source || !target || groupIds.length === 0) {
    return { steps, blocked: null };
  }
  if (source.role === "extra") {
    const scope = {
      ...source.scope,
      groupIds: source.scope.groupIds.filter((id) => !groupIds.includes(id)),
    };
    if (scopeSize(scope) === 0) {
      return {
        steps,
        blocked: `${source.name} must keep at least one group or ticket.`,
      };
    }
    steps.push({ id: source.id, scope, restore: source.scope });
  }
  if (target.role === "extra") {
    const scope = {
      ...target.scope,
      groupIds: [...new Set([...target.scope.groupIds, ...groupIds])],
    };
    steps.push({ id: target.id, scope, restore: target.scope });
  }
  return { steps, blocked: null };
}

function overrideText(override: OrchestratorPolicyOverride): string[] {
  const label = (
    options: readonly { value: string; label: string }[],
    value: string,
  ) => options.find((o) => o.value === value)?.label ?? value;
  const parts: string[] = [];
  if (override.roadmapApproval !== undefined) {
    parts.push(
      `Roadmap approval: ${label(ROADMAP_APPROVAL_OPTIONS, override.roadmapApproval)}`,
    );
  }
  if (override.concurrencyCap !== undefined) {
    parts.push(`Loops at once: ${override.concurrencyCap}`);
  }
  if (override.usageLimit !== undefined) {
    parts.push(
      `At a usage limit: ${label(USAGE_LIMIT_OPTIONS, override.usageLimit)}`,
    );
  }
  if (override.shipRights !== undefined) {
    parts.push(
      `Ship rights: ${label(SHIP_RIGHTS_OPTIONS, override.shipRights)}`,
    );
  }
  if (typeof override.budgetPerGroup === "number") {
    parts.push(`Budget per group (USD): ${override.budgetPerGroup}`);
  }
  return parts;
}

export interface OrchestratorRow {
  id: string;
  name: string;
  role: "Main" | "Extra";
  scope: string;
  owns: string;
  policy: string;
}

/** Build the rows of the Orchestrators table. */
export function orchestratorRows(
  records: readonly OwnerRecord[],
  cards: readonly Card[],
): OrchestratorRow[] {
  return records.map((record) => {
    const isMain = record.role === "main";
    const owned = isMain
      ? unownedOpenGroups(cards, records).map((c) => c.id)
      : [...record.scope.groupIds, ...record.scope.ticketIds];
    const policy = overrideText(record.policyOverride);
    return {
      id: record.id,
      name: record.name,
      role: isMain ? "Main" : "Extra",
      scope: isMain ? MAIN_SCOPE_TEXT : owned.join(", "),
      owns: owned.length === 0 ? "None" : owned.join(", "),
      policy: policy.length === 0 ? "Board policy" : policy.join(", "),
    };
  });
}
