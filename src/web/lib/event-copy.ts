import { COLUMN_LABELS } from "../../shared/column-labels.js";
import { LINEAR_PUSH_FAILED_PREFIX } from "../../shared/linear-state-map.js";
import type {
  AccountEventType,
  ActivityEvent,
  Column,
  EventType,
} from "../../shared/types.js";

export { COLUMN_LABELS };

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
 * no markup. The exhaustive `switch` over `EventType` and `AccountEventType` makes a future event
 * kind a compile error rather than a silent default string; `{from}`/`{to}` resolve through Title
 * Case `COLUMN_LABELS` and degrade to the bare verb when either column is absent.
 */
export function describeEvent(
  event: Omit<ActivityEvent, "type"> & { type: EventType | AccountEventType },
): string {
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
    case "group_unwound":
      return event.toCol
        ? `unwound, members sent to ${COLUMN_LABELS[event.toCol]}`
        : "unwound";
    case "group_restored":
      return event.toCol
        ? `restored to ${COLUMN_LABELS[event.toCol]}`
        : "restored";
    case "archive_deleted":
      return "archived workspace deleted";
    case "session_reset":
      return "reset to Inbox";
    case "item_promoted":
      return `promoted an item from ${event.source ?? "a source"}`;
    case "linear_state_pushed":
      return event.reason?.startsWith(LINEAR_PUSH_FAILED_PREFIX)
        ? event.reason.slice(LINEAR_PUSH_FAILED_PREFIX.length)
        : `Linear state set to ${event.reason ?? "a new state"}`;
    case "account_moved":
      return event.reason
        ? `Claude account moved: ${event.reason}`
        : "Claude account moved";
    case "account_login_changed":
      return "home Claude login changed";
    case "account_login_failed":
      return event.reason
        ? `Claude login failed: ${event.reason}`
        : "Claude login failed";
    default:
      return describeUnknownEvent(event.type);
  }
}
