import { createElement, type CSSProperties } from "react";
import { NEUTRAL_ACCENT, sourceAccent } from "./source-accent.js";
import { sourceMark } from "./source-mark.js";

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
              background: `color-mix(in srgb, ${color} 16%, transparent)`,
            }),
      }}
    >
      {createElement(sourceMark(source), { size: 16 })}
    </span>
  );
}
