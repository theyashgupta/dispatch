import type { CSSProperties, ReactNode } from "react";

type ChipTone = "neutral" | "accent" | "success" | "warning" | "danger";

interface ChipProps {
  tone?: ChipTone;
  icon?: ReactNode;
  title?: string;
  style?: CSSProperties;
  children: ReactNode;
}

const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  flex: "0 0 auto",
  height: "18px",
  padding: "0 var(--space-xs)",
  borderRadius: "var(--radius-sm)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-micro)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  whiteSpace: "nowrap",
};

const labelStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
};

export const CHIP_TONES: Record<ChipTone, CSSProperties> = {
  neutral: {
    color: "var(--text-muted)",
    border: "1px solid var(--border)",
  },
  accent: {
    color: "var(--accent)",
    background: "color-mix(in srgb, var(--accent) 16%, var(--surface-card))",
  },
  success: {
    color: "var(--status-ok)",
    background: "color-mix(in srgb, var(--status-ok) 16%, var(--surface-card))",
  },
  warning: {
    color: "var(--status-stale)",
    background:
      "color-mix(in srgb, var(--status-stale) 16%, var(--surface-card))",
  },
  danger: {
    color: "var(--destructive-text)",
    background:
      "color-mix(in srgb, var(--destructive) 16%, var(--surface-card))",
  },
};

export function Chip({
  tone = "neutral",
  icon,
  title,
  style,
  children,
}: ChipProps) {
  return (
    <span title={title} style={{ ...chipStyle, ...CHIP_TONES[tone], ...style }}>
      {icon}
      <span style={labelStyle}>{children}</span>
    </span>
  );
}
