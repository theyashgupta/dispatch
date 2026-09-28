const statusRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  color: "var(--text)",
} as const;

const dotStyle = {
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  flex: "0 0 auto",
} as const;

export function StatusRow({ color, text }: { color: string; text: string }) {
  return (
    <div role="status" aria-live="polite" style={statusRowStyle}>
      <span aria-hidden="true" style={{ ...dotStyle, background: color }} />
      {text}
    </div>
  );
}
