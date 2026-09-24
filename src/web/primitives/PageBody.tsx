import type { CSSProperties, ReactNode } from "react";

interface PageBodyProps {
  children?: ReactNode;
}

const scrollStyle: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
};

const columnStyle: CSSProperties = {
  maxWidth: "720px",
  margin: "0 auto",
  padding: "var(--space-lg)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
};

export function PageBody({ children }: PageBodyProps) {
  return (
    <div className="scroll-stable-y" style={scrollStyle}>
      <div style={columnStyle}>{children}</div>
    </div>
  );
}
