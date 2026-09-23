import type { CSSProperties, ReactNode } from "react";

interface KbdProps {
  children: ReactNode;
}

const kbdStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "18px",
  height: "18px",
  padding: "0 var(--space-xs)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--surface-card)",
  color: "var(--text-muted)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-micro)",
  lineHeight: "var(--line-label)",
};

export function Kbd({ children }: KbdProps) {
  return <kbd style={kbdStyle}>{children}</kbd>;
}
