import type { LucideIcon } from "lucide-react";
import type { SessionTone } from "../../../shared/session-states.js";
import { Badge } from "@/components/ui/badge";

interface ToneBadgeProps {
  label: string;
  tone: SessionTone;
  glyph: LucideIcon;
}

const STATUS_COLOR: Record<SessionTone, string> = {
  neutral: "var(--status-running)",
  muted: "var(--status-idle)",
  attention: "var(--status-waiting)",
  success: "var(--status-stopped)",
  error: "var(--status-errored)",
};

export function ToneBadge({ label, tone, glyph: Glyph }: ToneBadgeProps) {
  return (
    <Badge tone="state" stateColor={STATUS_COLOR[tone]}>
      <Glyph aria-hidden="true" />
      {label}
    </Badge>
  );
}
