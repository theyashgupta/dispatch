import type {
  Column,
  LinearStateMap,
  MappedColumn,
  TeamStateMap,
  WorkflowState,
} from "./types.js";

export const MAPPED_COLUMNS: readonly MappedColumn[] = [
  "todo",
  "in_progress",
  "needs_input",
  "in_review",
  "parked",
  "done",
];

/** The reason prefix a failed push writes on its `linear_state_pushed` event. */
export const LINEAR_PUSH_FAILED_PREFIX = "failed: ";

const DEFAULT_STATE_TYPE: Partial<Record<Column, string>> = {
  todo: "unstarted",
  in_progress: "started",
  needs_input: "started",
  done: "completed",
};

/**
 * The Linear state id a board column pushes for one team, or null for "do not sync".
 *
 * @remarks An explicit id wins only while it is still one of the team's states; a stale id falls
 * back to the type default, the lowest-position state of that type.
 */
export function resolveTargetState(
  teamMap: TeamStateMap | undefined,
  states: readonly WorkflowState[],
  column: Column,
): string | null {
  const explicit = teamMap?.[column as MappedColumn];
  if (explicit === null) return null;
  if (explicit && states.some((s) => s.id === explicit)) return explicit;
  const type = DEFAULT_STATE_TYPE[column];
  if (!type) return null;
  const candidates = states
    .filter((s) => s.type === type)
    .sort((a, b) => a.position - b.position);
  return candidates[0]?.id ?? null;
}

/** Whether a column can push at all for a team, known before the team's states are read. */
export function columnPushes(
  teamMap: TeamStateMap | undefined,
  column: Column,
): boolean {
  const explicit = teamMap?.[column as MappedColumn];
  return (
    explicit !== null &&
    (explicit !== undefined || column in DEFAULT_STATE_TYPE)
  );
}

/** Validate a raw state map: team ids to known columns with a non-empty state id or null. */
export function parseStateMap(
  raw: unknown,
): { ok: true; map: LinearStateMap } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "stateMap must be an object" };
  }
  const map: LinearStateMap = {};
  for (const [teamId, team] of Object.entries(raw as Record<string, unknown>)) {
    if (teamId === "__proto__") {
      return { ok: false, error: "invalid team id" };
    }
    if (typeof team !== "object" || team === null || Array.isArray(team)) {
      return { ok: false, error: `stateMap.${teamId} must be an object` };
    }
    const out: TeamStateMap = {};
    for (const [column, value] of Object.entries(
      team as Record<string, unknown>,
    )) {
      if (!(MAPPED_COLUMNS as readonly string[]).includes(column)) {
        return { ok: false, error: `unknown column: ${column}` };
      }
      if (value !== null && (typeof value !== "string" || value === "")) {
        return {
          ok: false,
          error: `stateMap.${teamId}.${column} must be a state id or null`,
        };
      }
      out[column as MappedColumn] = value;
    }
    map[teamId] = out;
  }
  return { ok: true, map };
}
