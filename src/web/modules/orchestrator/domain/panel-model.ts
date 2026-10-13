import {
  actionFailedText,
  refusalText,
} from "../../../../shared/decision-view.js";
import type { OrchestratorView } from "../../../../shared/types.js";

export type {
  OrchestratorSessionView,
  OrchestratorView,
} from "../../../../shared/types.js";

export type ControlKind = "start" | "stop" | "resume";

export interface PanelControl {
  kind: ControlKind;
  label: string;
  disabled: boolean;
  tooltip: string | null;
  reason: string | null;
}

export type TerminalMode =
  "empty" | "not-running" | "resume" | "connecting" | "live" | "unavailable";

export const STALE_REASON =
  "Reconnecting. Actions are off until the board stream is back.";
export const SUPERVISOR_OFF_REASON =
  "Turn on the supervisor in Policy to start an orchestrator.";
export const STOP_TOOLTIP =
  "Interrupt the current turn. The session stays open.";

const RESUME_STATES: readonly string[] = ["lost", "shell_prompt"];
const STOP_BLOCKED_STATES: readonly string[] = [
  "permission_prompt",
  "usage_limit_dialog",
  "usage_limit_wait",
  "shell_prompt",
];

interface ControlInput {
  supervisor: "on" | "off";
  stale: boolean;
  pending: ControlKind | null;
}

/**
 * Pick the Start, Stop or Resume control that one orchestrator record shows, or null while it changes state.
 *
 * @remarks A null record is a board with no orchestrator, which shows Start. The command centre uses this rule.
 */
export function controlFor(
  main: OrchestratorView | null,
  input: ControlInput,
): PanelControl | null {
  const state = main?.session?.state ?? null;
  const locked = input.stale || input.pending !== null;
  const stale = input.stale ? STALE_REASON : null;
  if (main?.state === "starting" || main?.state === "stopping") return null;
  if (state !== null && RESUME_STATES.includes(state)) {
    return {
      kind: "resume",
      label: "Resume orchestrator",
      disabled: locked,
      tooltip: null,
      reason: stale,
    };
  }
  if (main?.state === "running") {
    return {
      kind: "stop",
      label: "Stop",
      disabled:
        locked || (state !== null && STOP_BLOCKED_STATES.includes(state)),
      tooltip: STOP_TOOLTIP,
      reason: stale,
    };
  }
  const off = input.supervisor === "off";
  return {
    kind: "start",
    label: "Start orchestrator",
    disabled: locked || off,
    tooltip: null,
    reason: stale ?? (off ? SUPERVISOR_OFF_REASON : null),
  };
}

/** Pick the terminal mode of the main orchestrator record. */
export function terminalFor(main: OrchestratorView | null): TerminalMode {
  if (main === null) return "empty";
  const session = main.session;
  if (session?.ttydPort != null && session.activeSessionId !== null) {
    return "live";
  }
  if (main.state === "starting" || session?.hasTmuxSession === true) {
    return "connecting";
  }
  if (session?.state != null && RESUME_STATES.includes(session.state)) {
    return "resume";
  }
  return "not-running";
}

/** Build the terminal iframe path of a live terminal, or null for any other mode. */
export function terminalSrcFor(
  terminal: TerminalMode,
  main: OrchestratorView | null,
): string | null {
  return terminal === "live" && main?.session?.activeSessionId != null
    ? `/sessions/${main.session.activeSessionId}/terminal/`
    : null;
}

/** Turn a server refusal code and optional reason into the reason text of an error line. */
export const refusalReason = refusalText;

/** The error line of a failed start. */
export function startErrorCopy(reason: string): string {
  return `The orchestrator did not start: ${stripPeriod(reason)}.`;
}

export const actionErrorCopy = actionFailedText;

const ACTION_NAMES: Record<ControlKind, string> = {
  start: "Start",
  stop: "Stop",
  resume: "Resume",
};

/** The alert line for a failed control, which uses the start copy for Start and the action copy otherwise. */
export function failureCopy(kind: ControlKind, reason: string): string {
  return kind === "start"
    ? startErrorCopy(reason)
    : actionErrorCopy(ACTION_NAMES[kind], reason);
}

export function stripPeriod(text: string): string {
  return text.replace(/\.+$/, "");
}
