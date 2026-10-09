import type {
  EventType,
  GroupState,
  GroupStateData,
  OrchestrationEvent,
  SupervisorState,
} from "../../../shared/types.js";

/** The group state an activity event type maps to, or null for any other type. */
export function groupStateOfActivity(type: EventType): GroupState | null {
  switch (type) {
    case "status_agent_done":
      return "agent_done";
    case "status_needs_input":
      return "needs_input";
    default:
      return null;
  }
}

/** The group state a supervisor state change maps to, or null for a state the orchestrator is not told about. */
export function groupStateOfSupervisor(
  state: SupervisorState,
): GroupState | null {
  switch (state) {
    case "api_error":
    case "stale":
    case "lost":
    case "shell_prompt":
      return "loop_error";
    case "usage_limit_dialog":
    case "usage_limit_wait":
      return "usage_limit";
    default:
      return null;
  }
}

/**
 * The last group state of a card in a newest-first event list, or null when none stands.
 *
 * @remarks A `supervisor_state` row of the card that moved it to `working` is met before the last
 * `group_state` row only when the session resumed after that state, so the state no longer stands.
 */
export function lastGroupStateOf(
  events: readonly Pick<OrchestrationEvent, "cardId" | "kind" | "data">[],
  cardId: string,
): GroupState | null {
  for (const e of events) {
    if (e.cardId !== cardId) continue;
    if (e.kind === "group_state")
      return (e.data as Partial<GroupStateData>).state ?? null;
    if (e.kind === "supervisor_state" && e.data.to === "working") return null;
  }
  return null;
}
