import type { ActivityEvent, Column } from "../../shared/types.js";

/**
 * Title Case column labels for feed prose, kept local to this module so the copy layer never
 * reaches into the board feature for the uppercase labels (a forbidden cross-feature import) — the
 * feed reads Title Case names such as "In Progress", never the raw snake_case column keys.
 */
export const COLUMN_LABELS: Record<Column, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  needs_input: "Needs Input",
  agent_done: "Agent Done",
  in_review: "In Review",
  done: "Done",
  inbox: "Inbox",
};

function moveClause(
  verb: string,
  from: Column | null,
  to: Column | null,
): string {
  if (from == null || to == null) return verb;
  return `${verb} ${COLUMN_LABELS[from]} → ${COLUMN_LABELS[to]}`;
}

/**
 * Fallback for an `ActivityEvent.type` string that no longer matches any `EventType` member — e.g.
 * a historical `plan_ready` row read back from board.db's untyped TEXT column after the plan-stage
 * machinery was retired. The `never` parameter preserves compile-time exhaustiveness: a genuinely
 * new, unhandled `EventType` member would fail to assign here, so this can only ever catch stale
 * on-disk strings, not a forgotten case.
 */
function describeUnknownEvent(type: never): string {
  void type;
  return "activity";
}

/**
 * Render one `ActivityEvent` as its plain-text verb phrase only — no identifier, no timestamp,
 * no markup. The exhaustive `switch` over `EventType` makes a future event kind a compile error
 * rather than a silent default string; `{from}`/`{to}` resolve through Title Case `COLUMN_LABELS`
 * and degrade to the bare verb when either column is absent.
 */
export function describeEvent(event: ActivityEvent): string {
  switch (event.type) {
    case "sync_in":
      return "synced in from Linear";
    case "move_manual":
      return moveClause("moved", event.fromCol, event.toCol);
    case "move_auto":
      return moveClause("auto-moved", event.fromCol, event.toCol);
    case "status_needs_input":
      return "needs input";
    case "status_agent_done":
      return "agent done";
    case "status_done":
      return "done";
    case "session_start":
      return "session started";
    case "session_resume":
      return "session resumed";
    case "session_lost":
      return "session lost";
    case "session_failed":
      return "session failed to start";
    case "resume_failed":
      return "resume failed";
    case "cleanup":
      return "workspace cleaned up";
    case "local_created":
      return "created locally";
    case "sync_out":
      return "synced to Linear";
    case "group_created":
      return "group created";
    default:
      return describeUnknownEvent(event.type);
  }
}
