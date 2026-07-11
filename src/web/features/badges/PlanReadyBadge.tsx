export function PlanReadyBadge() {
  return (
    <span
      style={{
        flex: "0 0 auto",
        fontSize: "var(--font-label)",
        fontWeight: "var(--weight-semibold)",
        lineHeight: "var(--line-label)",
        color: "var(--col-in-planning)",
        background:
          "color-mix(in srgb, var(--col-in-planning) 16%, var(--surface-card))",
        borderRadius: "var(--radius)",
        padding: "0 var(--space-xs)",
        whiteSpace: "nowrap",
      }}
    >
      Plan ready
    </span>
  );
}
