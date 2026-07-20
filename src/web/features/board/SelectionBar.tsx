import { X } from "lucide-react";
import { Button } from "../../primitives/Button.js";
import { IconButton } from "../../primitives/IconButton.js";

interface SelectionBarProps {
  count: number;
  onStartGroup: () => void;
  onClear: () => void;
}

export function SelectionBar({
  count,
  onStartGroup,
  onClear,
}: SelectionBarProps) {
  if (count < 2) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "var(--space-xl)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 5,
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        boxShadow: "0 6px 16px rgba(0,0,0,0.45)",
        padding: "var(--space-sm) var(--space-lg)",
        display: "flex",
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
      <Button variant="primary" onClick={onStartGroup}>
        {`Start ${count} as group`}
      </Button>
      <IconButton aria-label="Clear selection" onClick={onClear}>
        <X size={16} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
