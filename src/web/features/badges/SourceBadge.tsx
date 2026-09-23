import {
  AlertTriangle,
  Bot,
  Calendar,
  CircleDot,
  FileText,
  GitBranch,
  Layers,
  MessageSquare,
  Mic,
  Tag,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import { NEUTRAL_ACCENT, sourceAccent } from "./source-accent.js";

export const SOURCE_GLYPH: Record<string, LucideIcon> = {
  github: GitBranch,
  linear: CircleDot,
  slack: MessageSquare,
  sentry: AlertTriangle,
  meeting: Mic,
  calendar: Calendar,
  agent: Bot,
  local: FileText,
  group: Layers,
};

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  flex: "0 0 auto",
  height: "18px",
  padding: "0 var(--space-xs)",
  borderRadius: "var(--radius-sm)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  whiteSpace: "nowrap",
};

export function SourceBadge({ source }: { source: string }) {
  const label = source.charAt(0).toUpperCase() + source.slice(1);
  const Glyph = SOURCE_GLYPH[source] ?? Tag;
  const color = sourceAccent(source);
  return (
    <span
      style={{
        ...badgeStyle,
        color,
        ...(color === NEUTRAL_ACCENT
          ? { border: "1px solid var(--border)" }
          : {
              background: `color-mix(in srgb, ${color} 16%, var(--surface-card))`,
            }),
      }}
    >
      <Glyph size={12} strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}
