import {
  ArrowRightLeft,
  CircleCheck,
  CirclePause,
  Clock,
  Gauge,
  Hourglass,
  MessageCircleQuestionMark,
  Pause,
  Play,
  ShieldQuestionMark,
  Snowflake,
  SquareTerminal,
  TriangleAlert,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import { SESSION_STATES } from "../../../shared/session-states.js";
import type { SupervisorState } from "../../../shared/types.js";
import { ToneBadge } from "./ToneBadge.js";

const GLYPHS: Record<SupervisorState, LucideIcon> = {
  working: Play,
  idle: Pause,
  needs_input: MessageCircleQuestionMark,
  permission_prompt: ShieldQuestionMark,
  handoff_ready: ArrowRightLeft,
  roadmap_complete: CircleCheck,
  usage_limit_dialog: Gauge,
  usage_limit_wait: Hourglass,
  api_error: TriangleAlert,
  stale: Clock,
  frozen: Snowflake,
  lost: Unplug,
  shell_prompt: SquareTerminal,
  paused: CirclePause,
};

interface SessionStateBadgeProps {
  state: SupervisorState;
}

export function SessionStateBadge({ state }: SessionStateBadgeProps) {
  const { label, tone } = SESSION_STATES[state];
  return <ToneBadge label={label} tone={tone} glyph={GLYPHS[state]} />;
}
