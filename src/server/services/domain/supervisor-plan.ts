import type {
  SupervisorState,
  SupervisorStateReason,
} from "../../../shared/types.js";
import type { Detection, PromptKind } from "./supervisor-state.js";

export type ContinueDuty = "restart" | "api_error" | "sleep_cut";

export type SupervisorAction =
  | { kind: "continue"; duty: ContinueDuty }
  | { kind: "needs_input"; reason: SupervisorStateReason }
  | { kind: "answer_prompt"; promptKind: "dangerous_delete" | "peer_message" }
  | { kind: "close_loop" }
  | { kind: "resume" }
  | { kind: "answer_limit" }
  | { kind: "escape_limit" }
  | { kind: "limit_move" }
  | { kind: "handoff" }
  | { kind: "relaunch_frozen"; frozenSince: string };

export interface LoopFacts {
  engineActive: boolean;
  handoffPending: boolean;
  unitPhase: string;
  orchestrator?: boolean;
}

export interface PlanMemory {
  prompts: Record<string, number>;
}

export interface PlanInput {
  from: SupervisorState | null;
  to: SupervisorState;
  promptKind?: PromptKind;
  loop: LoopFacts | null;
  usageLimit: "wait" | "stop";
  wokeAt: number | null;
  now: number;
  memory: PlanMemory;
}

const SLEEP_CUT_MS = 2 * 60_000;

/** Start the plan memory of one session: no continue prompt spent yet. */
export function initialPlanMemory(): PlanMemory {
  return { prompts: {} };
}

/**
 * Keep a stored `needs_input` that the supervisor set with a reason until the session shows life.
 *
 * @remarks A real busy sign, a permission prompt, a lost session, a shell prompt or a `frozen`
 * session releases a `supervisor_gave_up` hold. A `frozen` detection releases no other reason, a
 * `budget` hold ends only at a lost session or a shell prompt, and a `resume_failed` hold ends at a
 * busy sign or a confirmed idle prompt, so a failed resume is not planned on every sample.
 */
export function holdsNeedsInput(
  stored: SupervisorState | null,
  reason: SupervisorStateReason | undefined,
  detected: Pick<Detection, "state" | "busy">,
  engineOpen = false,
): boolean {
  if (stored !== "needs_input" || reason === undefined) return false;
  if (
    detected.state === "paused" ||
    (detected.state === "roadmap_complete" && engineOpen)
  )
    return false;
  if (detected.state === "frozen") return reason !== "supervisor_gave_up";
  if (reason === "budget")
    return detected.state !== "lost" && detected.state !== "shell_prompt";
  if (reason === "resume_failed")
    return !(
      detected.state === "idle" ||
      (detected.state === "working" && detected.busy === true)
    );
  switch (detected.state) {
    case "lost":
    case "shell_prompt":
    case "permission_prompt":
      return false;
    case "working":
      return detected.busy !== true;
    default:
      return true;
  }
}

/**
 * Take one slot of a once-per-phase budget: the first call plans `first`, every later call `after`.
 *
 * @remarks The count lives in the plan memory under `key`, so the caller stores the returned memory.
 */
function oncePerPhase(
  memory: PlanMemory,
  key: string,
  first: SupervisorAction,
  after: SupervisorAction,
): { actions: SupervisorAction[]; memory: PlanMemory } {
  const sent = memory.prompts[key] ?? 0;
  return {
    actions: [sent === 0 ? first : after],
    memory: { prompts: { ...memory.prompts, [key]: sent + 1 } },
  };
}

/**
 * Plan the actions for one state change; a repeated state never reaches the planner.
 *
 * @remarks Each continue duty prompts once per unit and phase; the next stop in the same phase
 * marks the session `needs_input` instead. The caller stores the returned memory.
 */
export function planActions(input: PlanInput): {
  actions: SupervisorAction[];
  memory: PlanMemory;
} {
  const { from, to, loop, memory } = input;
  const phase = loop?.unitPhase ?? "none";
  const none = { actions: [], memory };
  const once = (bucket: string, duty: ContinueDuty) =>
    oncePerPhase(
      memory,
      `${bucket}:${phase}`,
      { kind: "continue", duty },
      { kind: "needs_input", reason: "supervisor_gave_up" },
    );

  switch (to) {
    case "idle": {
      const wokeRecently =
        input.wokeAt !== null && input.now - input.wokeAt <= SLEEP_CUT_MS;
      if (wokeRecently && from === "working") return once("retry", "sleep_cut");
      if (loop?.engineActive && loop.orchestrator !== true)
        return once("restart", "restart");
      return none;
    }
    case "api_error":
      return once("retry", "api_error");
    case "permission_prompt":
      return input.promptKind === "dangerous_delete" ||
        input.promptKind === "peer_message"
        ? {
            actions: [{ kind: "answer_prompt", promptKind: input.promptKind }],
            memory,
          }
        : none;
    case "roadmap_complete":
      return loop?.engineActive && loop.orchestrator !== true
        ? { actions: [{ kind: "close_loop" }], memory }
        : none;
    case "lost":
    case "shell_prompt":
      return { actions: [{ kind: "resume" }], memory };
    case "usage_limit_dialog":
      return { actions: [{ kind: "answer_limit" }], memory };
    case "usage_limit_wait":
      if (from === "usage_limit_dialog") return none;
      if (input.usageLimit === "stop")
        return {
          actions: [{ kind: "needs_input", reason: "usage_stop" }],
          memory,
        };
      return {
        actions: [
          { kind: loop?.handoffPending ? "escape_limit" : "limit_move" },
        ],
        memory,
      };
    case "handoff_ready":
      return loop?.engineActive
        ? { actions: [{ kind: "handoff" }], memory }
        : none;
    default:
      return none;
  }
}

/**
 * Plan the relaunch of a session that stayed frozen, once per unit and phase.
 *
 * @remarks The second freeze in the same phase marks the session `needs_input` with `resume_failed`,
 * which a `frozen` detection does not release, so the card waits for a manual retry.
 */
export function planFrozenRelaunch(
  loop: LoopFacts | null,
  memory: PlanMemory,
  frozenSince: string,
): { actions: SupervisorAction[]; memory: PlanMemory } {
  return oncePerPhase(
    memory,
    `frozen:${loop?.unitPhase ?? "none"}`,
    { kind: "relaunch_frozen", frozenSince },
    { kind: "needs_input", reason: "resume_failed" },
  );
}

const MENU_ROW = /^\s*(❯)?\s*(\d+\.\s+\S.*|Deny\b.*|Deliver this message.*)$/;
const TARGET_ROW: Record<"dangerous_delete" | "peer_message", RegExp> = {
  dangerous_delete: /^\d+\.\s+No\b/,
  peer_message: /^Deny\b/,
};

/**
 * Read the last menu of a pane: its row labels and the row under the cursor.
 *
 * @remarks Rows are the trailing run of numbered rows or peer message rows; a pane with no
 * cursor row has no menu.
 */
export function readMenu(
  pane: string,
): { rows: string[]; cursor: number } | null {
  const lines = pane.split("\n");
  let end = lines.length - 1;
  while (end >= 0 && !MENU_ROW.test(lines[end])) end--;
  let start = end;
  while (start > 0 && MENU_ROW.test(lines[start - 1])) start--;
  if (end < 0) return null;
  const matches = lines
    .slice(start, end + 1)
    .map((line) => MENU_ROW.exec(line)!);
  const cursor = matches.findIndex((m) => m[1] !== undefined);
  return cursor < 0 ? null : { rows: matches.map((m) => m[2]), cursor };
}

/** Arrow keys that move the cursor onto the decline row, or null when the menu has no such row. */
export function declineKeys(
  pane: string,
  promptKind: "dangerous_delete" | "peer_message",
): string[] | null {
  const menu = readMenu(pane);
  if (menu === null) return null;
  const target = menu.rows.findIndex((row) => TARGET_ROW[promptKind].test(row));
  if (target < 0) return null;
  const step = target > menu.cursor ? "Down" : "Up";
  return Array<string>(Math.abs(target - menu.cursor)).fill(step);
}

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
const RESET_TIME =
  /(?:resets|automatically at)\s+(?:([A-Z][a-z]{2})\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;

/**
 * Read the limit reset time from a pane in local time, or null when no reset time is shown.
 *
 * @remarks A time with no date that is already past today means tomorrow; a dated time more than
 * a day in the past means next year.
 */
export function parseResetAt(pane: string, now: number): number | null {
  const m = RESET_TIME.exec(pane);
  if (m === null) return null;
  const [, monthName, dayText, hourText, minuteText, meridiem] = m;
  let hour = Number(hourText) % 12;
  if (meridiem.toLowerCase() === "pm") hour += 12;
  const at = new Date(now);
  at.setHours(hour, Number(minuteText ?? 0), 0, 0);
  if (monthName !== undefined) {
    const month = MONTHS.indexOf(monthName.toLowerCase());
    if (month < 0) return null;
    at.setMonth(month, Number(dayText));
    if (at.getTime() < now - 24 * 60 * 60_000)
      at.setFullYear(at.getFullYear() + 1);
  } else if (at.getTime() <= now) {
    at.setDate(at.getDate() + 1);
  }
  return at.getTime();
}
