import type { CSSProperties, ReactNode } from "react";
import { Button } from "./Button.js";

interface DetailScrollProps {
  testId?: string;
  children: ReactNode;
}

interface DetailHeaderProps {
  title: ReactNode;
  onBack?: () => void;
  children: ReactNode;
}

interface DetailPartProps {
  children: ReactNode;
}

const headerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
};

const scrollStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  flex: "1 1 auto",
  minWidth: 0,
  minHeight: 0,
  overflowY: "auto",
  padding: "var(--space-lg)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--font-heading)",
  lineHeight: "var(--line-heading)",
  fontWeight: "var(--weight-semibold)",
  color: "var(--text)",
  overflowWrap: "anywhere",
};

const metaStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--space-sm)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-sm)",
};

const placeholderStyle: CSSProperties = {
  padding: "var(--space-3xl) var(--space-lg)",
  textAlign: "center",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

export function DetailScroll({ testId, children }: DetailScrollProps) {
  return (
    <div style={scrollStyle} data-testid={testId}>
      {children}
    </div>
  );
}

function DetailTitle({ children }: DetailPartProps) {
  return <h2 style={titleStyle}>{children}</h2>;
}

function DetailMeta({ children }: DetailPartProps) {
  return <div style={metaStyle}>{children}</div>;
}

export function DetailActions({ children }: DetailPartProps) {
  return <div style={actionsStyle}>{children}</div>;
}

export function DetailPlaceholder({ children }: DetailPartProps) {
  return <div style={placeholderStyle}>{children}</div>;
}

export function DetailHeader({ title, onBack, children }: DetailHeaderProps) {
  return (
    <>
      {onBack && (
        <div>
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
        </div>
      )}
      <div style={headerStyle}>
        <DetailTitle>{title}</DetailTitle>
        <DetailMeta>{children}</DetailMeta>
      </div>
    </>
  );
}
