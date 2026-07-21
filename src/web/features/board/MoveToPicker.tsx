import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { COLUMNS } from "../../../shared/types.js";
import type {
  Card as CardModel,
  Column as ColumnId,
} from "../../../shared/types.js";
import { COLUMN_LABELS } from "../../lib/event-copy.js";

interface MoveToPickerProps {
  card: CardModel;
  anchorRect: DOMRect;
  onSelect: (column: ColumnId) => void;
  onClose: () => void;
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 260;
const ROW_HEIGHT = 44;
const GAP = 4;

export function MoveToPicker({
  card,
  anchorRect,
  onSelect,
  onClose,
}: MoveToPickerProps) {
  const firstRowRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("orientationchange", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("orientationchange", onClose);
    };
  }, [onClose]);

  useEffect(() => {
    firstRowRef.current?.focus();
  }, []);

  const menuWidth = Math.min(
    MAX_WIDTH,
    Math.max(MIN_WIDTH, window.innerWidth * 0.6),
  );
  const estimatedHeight = COLUMNS.length * ROW_HEIGHT + GAP * 2;
  const openAbove = anchorRect.bottom + estimatedHeight > window.innerHeight;
  const top = openAbove
    ? Math.max(GAP, anchorRect.top - estimatedHeight - GAP)
    : anchorRect.bottom + GAP;
  const left = Math.max(
    GAP,
    Math.min(anchorRect.left, window.innerWidth - menuWidth - GAP),
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
        aria-label={`Move ${card.identifier} to`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top,
          left,
          zIndex: 16,
          width: `${menuWidth}px`,
          background: "var(--surface-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          boxShadow: "0 6px 16px rgba(0,0,0,0.45)",
          padding: `${GAP}px 0`,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {COLUMNS.map((column, index) => {
          const current = card.column === column;
          return (
            <button
              key={column}
              ref={index === 0 ? firstRowRef : undefined}
              type="button"
              aria-current={current ? "true" : undefined}
              aria-disabled={current}
              onClick={() => {
                if (current) {
                  onClose();
                  return;
                }
                onSelect(column);
                onClose();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-sm)",
                minHeight: `${ROW_HEIGHT}px`,
                padding: "0 var(--space-lg)",
                width: "100%",
                background: "transparent",
                border: "none",
                cursor: current ? "default" : "pointer",
                fontSize: "var(--font-body)",
                fontWeight: current
                  ? "var(--weight-semibold)"
                  : "var(--weight-regular)",
                color: current ? "var(--accent)" : "var(--text)",
                textAlign: "left",
              }}
            >
              <span style={{ flex: "1 1 auto" }}>{COLUMN_LABELS[column]}</span>
              {current && (
                <Check
                  size={14}
                  strokeWidth={2}
                  aria-hidden="true"
                  style={{ color: "var(--accent)", flex: "0 0 auto" }}
                />
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
