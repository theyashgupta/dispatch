import { useEffect, useRef } from "react";
import type { UnwindDestination } from "../../../shared/types.js";

interface UnwindPickerProps {
  identifier: string;
  anchorRect: DOMRect;
  onSelect: (to: UnwindDestination) => void;
  onClose: () => void;
}

const ROWS: { to: UnwindDestination; label: string; hint: string }[] = [
  { to: "todo", label: "To Do", hint: "Members go back to the board" },
  { to: "inbox", label: "Inbox", hint: "Members leave the board" },
];

const WIDTH = 240;
const ROW_HEIGHT = 48;
const GAP = 4;
const BORDER = 1;

export function UnwindPicker({
  identifier,
  anchorRect,
  onSelect,
  onClose,
}: UnwindPickerProps) {
  const firstRowRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("orientationchange", onClose);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("orientationchange", onClose);
    };
  }, [onClose]);

  useEffect(() => {
    firstRowRef.current?.focus();
  }, []);

  const estimatedHeight = ROWS.length * ROW_HEIGHT + GAP * 2 + BORDER * 2;
  const openAbove = anchorRect.bottom + estimatedHeight > window.innerHeight;
  const top = openAbove
    ? Math.max(GAP, anchorRect.top - estimatedHeight - GAP)
    : anchorRect.bottom + GAP;
  const left = Math.max(
    GAP,
    Math.min(anchorRect.right - WIDTH, window.innerWidth - WIDTH - GAP),
  );

  return (
    <>
      <div
        aria-hidden="true"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        style={{
          position: "fixed",
          inset: 0,
          background: "transparent",
          zIndex: 15,
        }}
      />
      <div
        role="group"
        aria-label={`Unwind ${identifier}, send members to`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top,
          left,
          zIndex: 16,
          width: `${WIDTH}px`,
          background: "var(--surface-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-float)",
          padding: `${GAP}px 0`,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {ROWS.map((row, index) => (
          <button
            key={row.to}
            ref={index === 0 ? firstRowRef : undefined}
            type="button"
            onClick={() => {
              onSelect(row.to);
              onClose();
            }}
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              minHeight: `${ROW_HEIGHT}px`,
              padding: "0 var(--space-lg)",
              width: "100%",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--font-body)",
              color: "var(--text)",
              textAlign: "left",
            }}
          >
            <span style={{ fontWeight: "var(--weight-semibold)" }}>
              {row.label}
            </span>
            <span
              style={{
                fontSize: "var(--font-label)",
                lineHeight: "var(--line-label)",
                color: "var(--text-muted)",
              }}
            >
              {row.hint}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
