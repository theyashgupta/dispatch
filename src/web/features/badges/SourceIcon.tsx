import { Tag } from "lucide-react";
import type { CSSProperties } from "react";
import { SOURCE_GLYPH } from "./SourceBadge.js";
import { NEUTRAL_ACCENT, sourceAccent } from "./source-accent.js";

const iconStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "0 0 auto",
  width: "32px",
  height: "32px",
  borderRadius: "var(--radius)",
};

interface SourceIconProps {
  source: string;
}

export function SourceIcon({ source }: SourceIconProps) {
  const Glyph = SOURCE_GLYPH[source] ?? Tag;
  const color = sourceAccent(source);
  return (
    <span
      aria-hidden="true"
      style={{
        ...iconStyle,
        color,
        ...(color === NEUTRAL_ACCENT
          ? { border: "1px solid var(--border)" }
          : {
              background: `color-mix(in srgb, ${color} 16%, var(--surface-card))`,
            }),
      }}
    >
      <Glyph size={16} strokeWidth={2} />
    </span>
  );
}
