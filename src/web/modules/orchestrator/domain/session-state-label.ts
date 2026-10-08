import type { SupervisorState } from "../../../../shared/types.js";

export type StateTone = "attention" | "error" | "success" | "muted" | "neutral";

export type StateGlyph =
  | "Play"
  | "Pause"
  | "MessageCircleQuestionMark"
  | "ShieldQuestionMark"
  | "ArrowRightLeft"
  | "CircleCheck"
  | "Gauge"
  | "Hourglass"
  | "TriangleAlert"
  | "Clock"
  | "Unplug"
  | "SquareTerminal";

export interface StateLabel {
  label: string;
  glyph: StateGlyph;
  tone: StateTone;
}

export interface StateBadgeProps {
  variant?: "outline";
  tone?: "state" | "danger" | "success" | "neutral";
  stateColor?: string;
}

export const SESSION_STATE_LABELS: Record<SupervisorState, StateLabel> = {
  working: { label: "Working", glyph: "Play", tone: "neutral" },
  idle: { label: "Idle", glyph: "Pause", tone: "muted" },
  needs_input: {
    label: "Needs input",
    glyph: "MessageCircleQuestionMark",
    tone: "attention",
  },
  permission_prompt: {
    label: "Permission prompt",
    glyph: "ShieldQuestionMark",
    tone: "attention",
  },
  handoff_ready: {
    label: "Handing off",
    glyph: "ArrowRightLeft",
    tone: "neutral",
  },
  roadmap_complete: {
    label: "Roadmap done",
    glyph: "CircleCheck",
    tone: "success",
  },
  usage_limit_dialog: {
    label: "Usage limit dialog",
    glyph: "Gauge",
    tone: "attention",
  },
  usage_limit_wait: {
    label: "Waiting for usage reset",
    glyph: "Hourglass",
    tone: "muted",
  },
  api_error: { label: "API error", glyph: "TriangleAlert", tone: "error" },
  stale: { label: "No progress", glyph: "Clock", tone: "attention" },
  lost: { label: "Session lost", glyph: "Unplug", tone: "error" },
  shell_prompt: {
    label: "Claude exited",
    glyph: "SquareTerminal",
    tone: "error",
  },
};

/** Look up the label, glyph and tone of a session state, or null for a missing or unknown state. */
export function sessionStateLabel(state: string | null): StateLabel | null {
  return state !== null && Object.hasOwn(SESSION_STATE_LABELS, state)
    ? SESSION_STATE_LABELS[state as SupervisorState]
    : null;
}

/**
 * Map a state tone to the Badge props of the colour-free reading table.
 *
 * @remarks
 * The glyph and the label carry the state, so the colour is a second signal only.
 */
export function stateBadgeProps(tone: StateTone): StateBadgeProps {
  switch (tone) {
    case "attention":
      return { tone: "state", stateColor: "var(--col-needs-input)" };
    case "error":
      return { tone: "danger" };
    case "success":
      return { tone: "success" };
    case "muted":
      return { tone: "neutral" };
    case "neutral":
      return { variant: "outline" };
  }
}
