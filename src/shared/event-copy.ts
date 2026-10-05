import { COLUMN_LABELS } from "./column-labels.js";
import { LINEAR_PUSH_FAILED_PREFIX } from "./linear-state-map.js";
import type { ActivityEvent, Column } from "./types.js";

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
 * Fallback for an `ActivityEvent.type` string that matches no `EventType` member.
 *
 * @remarks
 * A historical row such as `plan_ready` can still sit in board.db's untyped TEXT column. The `never` parameter keeps the exhaustiveness check: a new `EventType` member fails to assign here, so only stale on-disk strings reach this.
 */
function describeUnknownEvent(type: never): string {
  void type;
  return "activity";
}

/**
 * Render one `ActivityEvent` as its plain-text verb phrase, with no identifier, timestamp or markup.
 *
 * @remarks
 * The exhaustive `switch` over `EventType` makes a new event kind a compile error instead of a silent default string. `{from}` and `{to}` resolve through the Title Case `COLUMN_LABELS` and degrade to the bare verb when either column is absent.
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
    default:
      return describeUnknownEvent(event.type);
  }
}
