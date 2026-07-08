import { type CSSProperties, type ReactNode } from "react";

interface NoticeProps {
  tone: "muted" | "destructive";
  label?: ReactNode;
  icon?: ReactNode;
  mono?: boolean;
  clamp?: boolean;
  action?: ReactNode;
  children?: ReactNode;
}

const destructiveHeadingStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  color: "var(--destructive)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
};

const mutedLabelledContainer: CSSProperties = {
  marginTop: "var(--space-lg)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
};

const mutedLabelStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

const mutedBodyStyle: CSSProperties = {
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const mutedSingleLineStyle: CSSProperties = {
  marginTop: "var(--space-xs)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-regular)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const monoScrollStyle: CSSProperties = {
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: "var(--space-xl)",
  maxHeight: "240px",
  overflowY: "auto",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-regular)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const monoClampStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-regular)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 3,
  overflow: "hidden",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

export function Notice({
  tone,
  label,
  icon,
  mono,
  clamp,
  action,
  children,
}: NoticeProps) {
  if (mono) {
    return (
      <div style={clamp ? monoClampStyle : monoScrollStyle}>{children}</div>
    );
  }
  if (tone === "destructive") {
    return (
      <div style={destructiveHeadingStyle}>
        {icon}
        <span>{label}</span>
      </div>
    );
  }
  if (label != null) {
    return (
      <div style={mutedLabelledContainer}>
        <span style={mutedLabelStyle}>{label}</span>
        <div style={mutedBodyStyle}>{children}</div>
        {action}
      </div>
    );
  }
  return <div style={mutedSingleLineStyle}>{children}</div>;
}
