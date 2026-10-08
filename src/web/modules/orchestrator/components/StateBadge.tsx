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
import { Badge } from "@/components/ui/badge";
import {
  stateBadgeProps,
  type StateGlyph,
  type StateLabel,
} from "@/modules/orchestrator/domain/session-state-label";

const GLYPHS: Record<StateGlyph, LucideIcon> = {
  Play,
  Pause,
  MessageCircleQuestionMark,
  ShieldQuestionMark,
  ArrowRightLeft,
  CircleCheck,
  Gauge,
  Hourglass,
  TriangleAlert,
  Clock,
  Unplug,
  SquareTerminal,
};

export function StateBadge({ state }: { state: StateLabel }) {
  const Glyph = GLYPHS[state.glyph];
  return (
    <Badge {...stateBadgeProps(state.tone)} data-testid="orchestrator-state">
      <Glyph aria-hidden="true" />
      {state.label}
    </Badge>
  );
}
