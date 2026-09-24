import type { CSSProperties, ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  count?: number;
  actions?: ReactNode;
}

const headerStyle: CSSProperties = {
  flex: "0 0 var(--page-header-height)",
  height: "var(--page-header-height)",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  minWidth: 0,
  padding: "0 var(--space-lg)",
  borderBottom: "1px solid var(--border)",
  background: "var(--surface-column)",
  userSelect: "none",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-heading)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-heading)",
  color: "var(--text)",
  whiteSpace: "nowrap",
};

const countStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-medium)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

const actionsStyle: CSSProperties = {
  marginLeft: "auto",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  minWidth: 0,
};

export function PageHeader({ title, count, actions }: PageHeaderProps) {
  return (
    <header style={headerStyle}>
      <h1 tabIndex={-1} style={{ ...titleStyle, outline: "none" }}>
        {title}
      </h1>
      {count != null && <span style={countStyle}>{count}</span>}
      {actions != null && <div style={actionsStyle}>{actions}</div>}
    </header>
  );
}
