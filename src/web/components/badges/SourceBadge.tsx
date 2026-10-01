import { createElement, type CSSProperties } from "react";
import { NEUTRAL_ACCENT, sourceAccent } from "./source-accent.js";
import { sourceMark } from "./source-mark.js";
import { sourceName } from "./source-name.js";

const tileStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "0 0 auto",
  width: "18px",
  height: "18px",
  borderRadius: "var(--radius-sm)",
};

const labelledStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  flex: "0 0 auto",
  whiteSpace: "nowrap",
};

const nameStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
};

interface SourceBadgeProps {
  source: string;
  label?: boolean;
}

export function SourceBadge({ source, label = false }: SourceBadgeProps) {
  const name = sourceName(source);
  const color = sourceAccent(source);
  const tile = (
    <span
      {...(label
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": name, title: name })}
      style={{
        ...tileStyle,
        color,
        ...(color === NEUTRAL_ACCENT
          ? { border: "1px solid var(--border)" }
          : { background: `color-mix(in srgb, ${color} 16%, transparent)` }),
      }}
    >
      {createElement(sourceMark(source), { size: 12 })}
    </span>
  );
  if (!label) return tile;
  return (
    <span style={labelledStyle}>
      {tile}
      <span style={nameStyle}>{name}</span>
    </span>
  );
}
