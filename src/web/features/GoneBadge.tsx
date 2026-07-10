export function GoneBadge() {
  return (
    <span
      style={{
        flex: "0 0 auto",
        fontSize: "var(--font-label)",
        fontWeight: "var(--weight-semibold)",
        lineHeight: "var(--line-label)",
        color: "var(--text-muted)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "0 var(--space-xs)",
        whiteSpace: "nowrap",
      }}
    >
      Out of sync scope
    </span>
  );
}
