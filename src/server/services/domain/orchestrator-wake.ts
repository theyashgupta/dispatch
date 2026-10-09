import type {
  OrchestrationEvent,
  SessionTurnState,
  SupervisorState,
} from "../../../shared/types.js";

export interface WakeReason {
  key: string;
  eventId: number | null;
  text: string;
}

const WAKE_GAP_MS = 20_000;
export const TIMER_KEY = "timer";

const NO_TYPING_STATES: ReadonlySet<SupervisorState> = new Set([
  "needs_input",
  "permission_prompt",
  "usage_limit_dialog",
  "usage_limit_wait",
  "api_error",
  "lost",
  "stale",
  "shell_prompt",
]);

const MAX_REASONS = 5;
const MAX_REASON_CHARS = 60;

const textOf = (value: unknown): string =>
  typeof value === "string" ? value : "";

type WakeEvent = Pick<OrchestrationEvent, "id" | "kind" | "data">;

/**
 * The orchestrator that an event wakes, or null when no orchestrator owns it.
 *
 * @remarks A decision answer goes to the orchestrator it names; a group event goes to `groupOwner`,
 * which the caller resolves by the scope rule (an extra that holds the group, else the main).
 */
export function wakeTargetOf(
  event: Pick<OrchestrationEvent, "kind" | "data">,
  groupOwner: string | null,
): string | null {
  if (event.kind === "decision_answered") {
    const id = event.data.orchestratorId;
    return typeof id === "string" && id !== "" ? id : null;
  }
  return event.kind === "group_state" ? groupOwner : null;
}

/** The queue reason of an event, or null for a kind that never wakes; `groupLabel` names the group card. */
export function eventReason(
  event: WakeEvent,
  groupLabel: string,
): WakeReason | null {
  const key = `event:${event.id}`;
  if (event.kind === "decision_answered") {
    const decisionId = textOf(event.data.decisionId);
    return {
      key,
      eventId: event.id,
      text: `decision ${decisionId} answered`,
    };
  }
  if (event.kind === "group_state") {
    return {
      key,
      eventId: event.id,
      text: `${groupLabel} ${textOf(event.data.state)}`,
    };
  }
  return null;
}

export function timerReason(wakeMinutes: number): WakeReason {
  return {
    key: TIMER_KEY,
    eventId: null,
    text: `timer ${wakeMinutes} min`,
  };
}

/** The queue without the reasons of the given events; a reason with no event id stays. */
export function withoutEvents(
  queue: readonly WakeReason[],
  eventIds: readonly number[],
): WakeReason[] {
  return queue.filter(
    (r) => r.eventId === null || !eventIds.includes(r.eventId),
  );
}

/** The queue with one more reason, unless its key is queued already. */
export function enqueueReason(
  queue: readonly WakeReason[],
  reason: WakeReason,
): WakeReason[] {
  return queue.some((r) => r.key === reason.key)
    ? [...queue]
    : [...queue, reason];
}

export interface WakeFacts {
  inFlight: boolean;
  sessionState: SupervisorState | null;
  lastLineAt: number | null;
  now: number;
  paneReady: boolean;
  paneBusy: boolean;
  turn: SessionTurnState;
}

export function mayWake(facts: WakeFacts): boolean {
  return (
    !facts.inFlight &&
    !(
      facts.sessionState !== null && NO_TYPING_STATES.has(facts.sessionState)
    ) &&
    (facts.lastLineAt === null ||
      facts.now - facts.lastLineAt >= WAKE_GAP_MS) &&
    facts.paneReady &&
    !facts.paneBusy &&
    facts.turn !== "busy"
  );
}

/**
 * The wake line for a list of reasons: the first five, then `and <n> more`.
 *
 * @remarks Each reason is cut to 60 characters, so the line stays under 500 characters and the
 * confirmed send types it whole instead of through a pointer file.
 */
export function wakeLine(reasons: readonly string[]): string {
  const shown = reasons
    .slice(0, MAX_REASONS)
    .map((r) => r.slice(0, MAX_REASON_CHARS));
  const more = reasons.length - shown.length;
  if (more > 0) shown.push(`and ${more} more`);
  return `Dispatch wake: ${shown.join(", ")}. Read the board state with the dispatch tools and continue.`;
}

export function timerDue(facts: {
  wakeMinutes: number;
  lastActivityAt: number;
  now: number;
}): boolean {
  return (
    facts.wakeMinutes > 0 &&
    facts.now - facts.lastActivityAt >= facts.wakeMinutes * 60_000
  );
}
