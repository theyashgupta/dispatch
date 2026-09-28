import type { CSSProperties, ReactNode } from "react";
import { Button } from "./Button.js";
import { Notice } from "./Notice.js";

interface SplitViewProps {
  narrow: boolean;
  showDetail: boolean;
  list: ReactNode;
  detail: ReactNode;
}

interface ListPaneProps {
  narrow: boolean;
  toolbar: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
}

interface DetailPaneProps {
  children: ReactNode;
}

interface ConnectPromptProps {
  testId: string;
  children: ReactNode;
}

interface PaneEmptyProps {
  children: ReactNode;
  testId?: string;
}

const pageStyle: CSSProperties = {
  display: "flex",
  flex: "1 1 auto",
  minHeight: 0,
  minWidth: 0,
};

const listPaneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: "0 0 480px",
  minWidth: 0,
  minHeight: 0,
  borderRight: "1px solid var(--border)",
};

const toolbarStyle: CSSProperties = {
  flex: "0 0 auto",
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "var(--space-sm)",
  padding: "var(--space-sm) var(--space-lg)",
  borderBottom: "1px solid var(--border)",
  background: "var(--surface-column)",
};

const scrollStyle: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
};

const detailPaneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: "1 1 auto",
  minWidth: 0,
  minHeight: 0,
};

const emptyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  padding: "var(--space-3xl) var(--space-lg)",
  textAlign: "center",
  alignItems: "center",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

export function SplitView({
  narrow,
  showDetail,
  list,
  detail,
}: SplitViewProps) {
  if (narrow) return <div style={pageStyle}>{showDetail ? detail : list}</div>;
  return (
    <div style={pageStyle}>
      {list}
      {detail}
    </div>
  );
}

export function ListPane({ narrow, toolbar, notice, children }: ListPaneProps) {
  return (
    <div
      style={
        narrow
          ? { ...listPaneStyle, flex: "1 1 auto", borderRight: "none" }
          : listPaneStyle
      }
    >
      <div style={toolbarStyle}>{toolbar}</div>
      {notice != null && (
        <div style={{ padding: "var(--space-sm) var(--space-lg)" }}>
          {notice}
        </div>
      )}
      <div className="scroll-stable-y" style={scrollStyle}>
        {children}
      </div>
    </div>
  );
}

export function DetailPane({ children }: DetailPaneProps) {
  return <div style={detailPaneStyle}>{children}</div>;
}

export function PaneEmpty({ children, testId }: PaneEmptyProps) {
  return (
    <div style={emptyStyle} data-testid={testId}>
      {children}
    </div>
  );
}

export function ConnectPrompt({ testId, children }: ConnectPromptProps) {
  return (
    <PaneEmpty testId={testId}>
      <Notice
        tone="muted"
        label="Connect a source"
        action={
          <Button
            variant="primary"
            onClick={() => {
              window.location.hash = "#/settings";
            }}
            style={{ alignSelf: "center" }}
          >
            Open Settings
          </Button>
        }
      >
        {children}
      </Notice>
    </PaneEmpty>
  );
}
