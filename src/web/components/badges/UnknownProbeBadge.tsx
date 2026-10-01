import type { ProbeFailureCategory } from "../../../shared/types.js";
import { unknownProbeCopy } from "./unknown-probe-copy.js";

export function UnknownProbeBadge({
  signal,
  category,
  partial,
}: {
  signal: "pr" | "preview";
  category: ProbeFailureCategory;
  partial?: boolean;
}) {
  const { label, detail } = unknownProbeCopy(signal, category, partial);
  return (
    <span
      title={detail}
      style={{
        flex: "0 0 auto",
        fontSize: "var(--font-label)",
        fontWeight: "var(--weight-semibold)",
        lineHeight: "var(--line-label)",
        color: "var(--text-muted)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        padding: "0 var(--space-xs)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}
