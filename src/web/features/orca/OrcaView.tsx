export function OrcaView() {
  return (
    <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex" }}>
      <nav
        aria-label="Tickets"
        style={{
          width: "var(--orca-nav-width)",
          flex: "0 0 auto",
          borderRight: "1px solid var(--border)",
          background: "var(--surface-column)",
          overflowY: "auto",
        }}
      />
    </div>
  );
}
