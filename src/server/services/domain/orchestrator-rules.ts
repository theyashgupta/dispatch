import type {
  BoardPolicy,
  Card,
  OrchestratorPolicyOverride,
  OrchestratorRecord,
} from "../../../shared/types.js";

export type RecordsRefusal =
  | { ok: false; code: "duplicate-id"; id: string }
  | { ok: false; code: "main-exists" }
  | { ok: false; code: "extra-needs-main" }
  | { ok: false; code: "main-has-scope" }
  | { ok: false; code: "main-has-override" }
  | { ok: false; code: "extra-needs-scope"; id: string }
  | { ok: false; code: "group-owned"; groupId: string; owner: string }
  | { ok: false; code: "ticket-owned"; ticketId: string; owner: string }
  | {
      ok: false;
      code: "wider-override";
      field: keyof OrchestratorPolicyOverride;
    };

export type RecordsCheck = { ok: true } | RecordsRefusal;

type OverrideField = keyof OrchestratorPolicyOverride;

const OVERRIDE_FIELDS: readonly OverrideField[] = [
  "roadmapApproval",
  "concurrencyCap",
  "usageLimit",
  "shipRights",
  "budgetPerGroup",
];

const RANKS = {
  roadmapApproval: ["ask", "rules", "all"],
  usageLimit: ["stop", "wait"],
  shipRights: ["none", "open_prs", "merge"],
} as const;

/**
 * Rank a policy value so that a lower rank is the narrower value.
 *
 * @remarks
 * A null budget means no budget, so it ranks above every number.
 */
function rank(field: OverrideField, value: unknown): number {
  if (field === "concurrencyCap") return value as number;
  if (field === "budgetPerGroup") {
    return value === null ? Number.POSITIVE_INFINITY : (value as number);
  }
  return (RANKS[field] as readonly unknown[]).indexOf(value);
}

/** Answer the first override field whose value is wider than the board value, or null. */
export function widerOverrideField(
  policy: BoardPolicy,
  override: OrchestratorPolicyOverride,
): OverrideField | null {
  for (const field of OVERRIDE_FIELDS) {
    if (override[field] === undefined) continue;
    if (rank(field, override[field]) > rank(field, policy[field])) return field;
  }
  return null;
}

/**
 * Apply an orchestrator override to the board policy, taking the narrower value per field.
 *
 * @remarks
 * The board policy can narrow after the override was saved, so the override never
 * widens the board value even when it was valid when written.
 */
export function effectivePolicy(
  policy: BoardPolicy,
  record: OrchestratorRecord | undefined,
): BoardPolicy {
  const result = { ...policy };
  const override = record?.policyOverride ?? {};
  for (const field of OVERRIDE_FIELDS) {
    const value = override[field];
    if (value === undefined) continue;
    if (rank(field, value) < rank(field, result[field])) {
      (result as Record<OverrideField, unknown>)[field] = value;
    }
  }
  return result;
}

/**
 * Check a full set of orchestrator records of one board against the ownership rules.
 *
 * @remarks
 * Each group id may sit in the scope of one extra only; the second extra that lists it
 * is refused with the first one as the owner. Only the overrides of `changedIds` must narrow the
 * board policy, so a stale wider override on an untouched record (the board policy narrowed after
 * it was saved) does not block an add, edit or remove of another record.
 */
export function checkRecords(
  policy: BoardPolicy,
  records: OrchestratorRecord[],
  changedIds: readonly string[] = records.map((r) => r.id),
): RecordsCheck {
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id))
      return { ok: false, code: "duplicate-id", id: record.id };
    ids.add(record.id);
  }
  const mains = records.filter((r) => r.role === "main");
  if (mains.length > 1) return { ok: false, code: "main-exists" };
  const extras = records.filter((r) => r.role === "extra");
  if (extras.length > 0 && mains.length === 0) {
    return { ok: false, code: "extra-needs-main" };
  }
  const main = mains[0];
  if (main && main.scope.groupIds.length + main.scope.ticketIds.length > 0) {
    return { ok: false, code: "main-has-scope" };
  }
  if (main && Object.keys(main.policyOverride).length > 0) {
    return { ok: false, code: "main-has-override" };
  }
  const owners = new Map<string, string>();
  for (const extra of extras) {
    if (extra.scope.groupIds.length + extra.scope.ticketIds.length === 0) {
      return { ok: false, code: "extra-needs-scope", id: extra.id };
    }
    for (const groupId of extra.scope.groupIds) {
      const owner = owners.get(groupId);
      if (owner !== undefined && owner !== extra.id) {
        return { ok: false, code: "group-owned", groupId, owner };
      }
      owners.set(groupId, extra.id);
    }
    for (const ticketId of extra.scope.ticketIds) {
      const owner = owners.get(ticketId);
      if (owner !== undefined && owner !== extra.id) {
        return { ok: false, code: "ticket-owned", ticketId, owner };
      }
      owners.set(ticketId, extra.id);
    }
  }
  for (const record of records) {
    if (!changedIds.includes(record.id)) continue;
    const field = widerOverrideField(policy, record.policyOverride);
    if (field) return { ok: false, code: "wider-override", field };
  }
  return { ok: true };
}

export function mainOrchestrator(
  records: OrchestratorRecord[],
): OrchestratorRecord | undefined {
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
  records: OrchestratorRecord[],
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
  records: OrchestratorRecord[],
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

/** Decide whether an orchestrator may start a ship flow: only the main may, once records exist. */
export function mayShip(
  records: OrchestratorRecord[],
  orchestratorId: string,
): boolean {
  if (records.length === 0) return true;
  return mainOrchestrator(records)?.id === orchestratorId;
}
