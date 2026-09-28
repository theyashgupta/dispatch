import { X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./IconButton.js";

interface FloatBarProps {
  count: number;
  onClear: () => void;
  children: ReactNode;
  testId?: string;
}

export function FloatBar({ count, onClear, children, testId }: FloatBarProps) {
  return (
    <div
      data-testid={testId}
      style={{
        position: "fixed",
        bottom: "var(--space-xl)",
        left: "50%",
        transform: "translateX(-50%)",
        width: "max-content",
        maxWidth: "calc(100vw - 2 * var(--space-lg))",
        zIndex: 5,
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow-float)",
        padding: "var(--space-sm) var(--space-lg)",
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: "var(--space-lg)",
      }}
    >
      <span
        style={{
          fontSize: "var(--font-label)",
          fontWeight: "var(--weight-semibold)",
          lineHeight: "var(--line-label)",
          color: "var(--text-muted)",
        }}
      >
        {count} selected
      </span>
      {children}
      <IconButton aria-label="Clear selection" onClick={onClear}>
        <X size={16} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
