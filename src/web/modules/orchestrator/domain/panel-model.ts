import {
  actionFailedText,
  refusalText,
} from "../../../../shared/decision-view.js";
import type {
  OrchestratorView,
  SupervisorState,
} from "../../../../shared/types.js";

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

export interface PanelInput {
  orchestrators: readonly OrchestratorView[];
  supervisor: "on" | "off";
  stale: boolean;
  pending: ControlKind | null;
  decisionCount: number;
  loaded?: boolean;
}

export interface PanelModel {
  main: OrchestratorView | null;
  stateKey: SupervisorState | null;
  transition: "Starting" | "Stopping" | null;
  control: PanelControl | null;
  terminal: TerminalMode;
  terminalSrc: string | null;
  startFailure: string | null;
  tabs: {
    terminal: string;
    decisions: string;
    policy: string;
    orchestrators: string;
  };
}

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

function controlFor(
  main: OrchestratorView | null,
  input: PanelInput,
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

function terminalFor(main: OrchestratorView | null): TerminalMode {
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

/**
 * Derive what the panel header, terminal and tabs show from the panel data.
 *
 * @remarks
 * Only the main orchestrator drives the header. Resume shows only at `lost` and
 * `shell_prompt`, where Start and Stop do not show. Every control is off while the board stream is
 * down or an action is in flight, and none shows when the orchestrator list never loaded.
 */
export function panelModel(input: PanelInput): PanelModel {
  const main = input.orchestrators.find((o) => o.role === "main") ?? null;
  const loaded = input.loaded !== false;
  const terminal = loaded ? terminalFor(main) : "unavailable";
  return {
    main,
    stateKey: main?.session?.state ?? null,
    transition:
      main?.state === "starting" ||
      (main?.state === "running" && main.session?.state == null)
        ? "Starting"
        : main?.state === "stopping"
          ? "Stopping"
          : null,
    control: loaded ? controlFor(main, input) : null,
    terminal,
    terminalSrc:
      terminal === "live" && main?.session?.activeSessionId != null
        ? `/sessions/${main.session.activeSessionId}/terminal/`
        : null,
    startFailure:
      main?.state === "stopped" && main.session?.startError
        ? startErrorCopy(main.session.startError)
        : null,
    tabs: {
      terminal: "Terminal",
      decisions: `Decisions (${input.decisionCount})`,
      policy: "Policy",
      orchestrators: loaded
        ? `Orchestrators (${input.orchestrators.length})`
        : "Orchestrators",
    },
  };
}

/** Turn a server refusal code and optional reason into the reason text of an error line. */
export const refusalReason = refusalText;

/** The error line of a failed start. */
export function startErrorCopy(reason: string): string {
  return `The orchestrator did not start: ${stripPeriod(reason)}.`;
}

export const actionErrorCopy = actionFailedText;

/** The error line of a failed panel load. */
export function loadErrorCopy(message: string): string {
  return `The orchestrator panel did not load: ${stripPeriod(message)}.`;
}

/** The text of the Stale badge for a formatted last update time. */
export function staleBadgeText(time: string): string {
  return `State from ${time}`;
}

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

function stripPeriod(text: string): string {
  return text.replace(/\.+$/, "");
}
