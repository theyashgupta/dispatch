import type { LucideIcon } from "lucide-react";
import type { SessionTone } from "../../../shared/session-states.js";
import { Badge } from "@/components/ui/badge";

interface ToneBadgeProps {
  label: string;
  tone: SessionTone;
  glyph: LucideIcon;
}

export function ToneBadge({ label, tone, glyph: Glyph }: ToneBadgeProps) {
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
