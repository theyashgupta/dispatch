import {
  ArrowRightLeft,
  CircleCheck,
  Clock,
  Gauge,
  Hourglass,
  MessageCircleQuestionMark,
  Pause,
  Play,
  ShieldQuestionMark,
  SquareTerminal,
  TriangleAlert,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import { SESSION_STATES } from "../../../shared/session-states.js";
import type { SupervisorState } from "../../../shared/types.js";
import { Badge } from "@/components/ui/badge";

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
  lost: Unplug,
  shell_prompt: SquareTerminal,
};

interface SessionStateBadgeProps {
  state: SupervisorState;
}

export function SessionStateBadge({ state }: SessionStateBadgeProps) {
  const { label, tone } = SESSION_STATES[state];
  const Glyph = GLYPHS[state];
  const content = (
    <>
      <Glyph aria-hidden="true" />
      {label}
    </>
  );
  switch (tone) {
    case "attention":
      return (
        <Badge tone="state" stateColor="var(--col-needs-input)">
          {content}
        </Badge>
      );
    case "error":
      return <Badge tone="danger">{content}</Badge>;
    case "success":
      return <Badge tone="success">{content}</Badge>;
    case "muted":
      return <Badge tone="neutral">{content}</Badge>;
    case "neutral":
      return <Badge variant="outline">{content}</Badge>;
  }
}
