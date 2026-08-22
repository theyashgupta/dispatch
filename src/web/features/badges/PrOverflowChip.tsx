import type { CSSProperties } from "react";

export const PR_CHIP_CAP = 3;

const overflowChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  borderRadius: "var(--radius-sm)",
  padding: "0 var(--space-xs)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
  border: "1px solid var(--border)",
  color: "var(--text-muted)",
};

export function PrOverflowChip({ hidden }: { hidden: number }) {
  const label = `${hidden} more pull request${hidden === 1 ? "" : "s"}`;
  return (
    <span style={overflowChipStyle} title={label} aria-label={label}>
      {`+${hidden}`}
    </span>
  );
}
