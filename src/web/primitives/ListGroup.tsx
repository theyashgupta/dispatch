import type { CSSProperties, ReactNode } from "react";
import { Chip } from "./Chip.js";
import { Collapsible } from "./Collapsible.js";

interface ListGroupProps {
  title: string;
  count: number;
  testId?: string;
  children: ReactNode;
}

interface RowTimeProps {
  children: ReactNode;
}

const timeStyle: CSSProperties = {
  flex: "0 0 48px",
  textAlign: "right",
  fontSize: "var(--font-label)",
  color: "var(--text-muted)",
};

const groupStyle: CSSProperties = { padding: "0 var(--space-lg)" };

const listStyle: CSSProperties = { margin: "0 calc(-1 * var(--space-lg))" };

export function ListGroup({ title, count, testId, children }: ListGroupProps) {
  return (
    <div style={groupStyle} data-testid={testId}>
      <Collapsible title={title} badge={<Chip>{count}</Chip>} defaultOpen>
        <div role="list" style={listStyle}>
          {children}
        </div>
      </Collapsible>
    </div>
  );
}

export function RowTime({ children }: RowTimeProps) {
  return <span style={timeStyle}>{children}</span>;
}
