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
  | { kind: "handoff" };

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
 * @remarks Only a real busy sign, a permission prompt (a new tool request), a lost session or a
 * shell prompt releases the hold. A `budget` stop holds until a lost session or a shell prompt, and
 * a `resume_failed` hold until a real busy sign, so a failed resume is not planned on every sample.
 */
export function holdsNeedsInput(
  stored: SupervisorState | null,
  reason: SupervisorStateReason | undefined,
  detected: Pick<Detection, "state" | "busy">,
): boolean {
  if (stored !== "needs_input" || reason === undefined) return false;
  if (reason === "budget")
    return detected.state !== "lost" && detected.state !== "shell_prompt";
  if (reason === "resume_failed")
    return !(detected.state === "working" && detected.busy === true);
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
  const once = (bucket: string, duty: ContinueDuty) => {
    const key = `${bucket}:${phase}`;
    const sent = memory.prompts[key] ?? 0;
    const next = { prompts: { ...memory.prompts, [key]: sent + 1 } };
    return sent === 0
      ? { actions: [{ kind: "continue", duty } as const], memory: next }
      : {
          actions: [
            { kind: "needs_input", reason: "supervisor_gave_up" } as const,
          ],
          memory: next,
        };
  };

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
      return loop?.engineActive
        ? { actions: [{ kind: "close_loop" }], memory }
        : none;
    case "lost":
    case "shell_prompt":
      return { actions: [{ kind: "resume" }], memory };
    case "usage_limit_dialog":
      return { actions: [{ kind: "answer_limit" }], memory };
    case "usage_limit_wait":
      return input.usageLimit === "wait" && loop?.handoffPending
        ? { actions: [{ kind: "escape_limit" }], memory }
        : none;
    case "handoff_ready":
      return loop?.engineActive
        ? { actions: [{ kind: "handoff" }], memory }
        : none;
    default:
      return none;
  }
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
