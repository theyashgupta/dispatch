import { useEffect, type CSSProperties, type ReactNode } from "react";

interface NavSheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

const scrimStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "color-mix(in srgb, var(--bg) 60%, transparent)",
  zIndex: 12,
};

const sheetStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  height: "100dvh",
  width: "var(--nav-width)",
  maxWidth: "85vw",
  background: "var(--surface-column)",
  borderRight: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  zIndex: 13,
};

export function NavSheet({ open, onClose, children }: NavSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const first = document.querySelector<HTMLElement>(
      "#nav-sheet button, #nav-sheet [tabindex]",
    );
    first?.focus();
  }, [open]);

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          ...scrimStyle,
          pointerEvents: open ? "auto" : "none",
          opacity: open ? 1 : 0,
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        id="nav-sheet"
        inert={!open}
        aria-hidden={!open}
        style={{
          ...sheetStyle,
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: open
            ? "transform var(--motion-panel-open) var(--easing-enter)"
            : "transform var(--motion-panel-close) var(--easing-exit)",
        }}
      >
        {children}
      </aside>
    </>
  );
}
