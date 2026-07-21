import { COLUMNS } from "../../../shared/types.js";
import type {
  Card as CardModel,
  Column as ColumnId,
} from "../../../shared/types.js";
import { COLUMN_ACCENT, COLUMN_LABELS } from "./column-meta.js";

interface StatusPillSwitcherProps {
  cards: CardModel[];
  active: ColumnId | null;
  onSelect: (column: ColumnId) => void;
}

export function StatusPillSwitcher({
  cards,
  active,
  onSelect,
}: StatusPillSwitcherProps) {
  return (
    <div
      role="tablist"
      aria-label="Jump to board column"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        overflowX: "auto",
        flex: "0 0 auto",
        padding: "var(--space-sm) var(--space-lg)",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
      }}
    >
      {COLUMNS.map((column) => {
        const count = cards.filter(
          (c) => c.column === column && c.groupId == null,
        ).length;
        const isActive = column === active;
        return (
          <button
            key={column}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={`${COLUMN_LABELS[column]}, ${count} card${
              count === 1 ? "" : "s"
            }`}
            onClick={() => onSelect(column)}
            style={{
              flex: "0 0 auto",
              paddingBlock: "8px",
              marginBlock: "-8px",
              paddingInline: 0,
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-xs)",
                height: "32px",
                padding: "0 var(--space-sm)",
                borderRadius: "var(--radius)",
                border: isActive
                  ? "1px solid var(--accent)"
                  : "1px solid var(--border)",
                background: "var(--surface-column)",
                color: isActive ? "var(--accent)" : "var(--text-muted)",
                fontSize: "var(--font-label)",
                fontWeight: "var(--weight-semibold)",
                lineHeight: "var(--line-label)",
                letterSpacing: "0.04em",
                whiteSpace: "nowrap",
              }}
            >
              {COLUMN_LABELS[column]}
              <span
                style={{
                  background: `color-mix(in srgb, ${COLUMN_ACCENT[column]} 16%, var(--surface-column))`,
                  color: COLUMN_ACCENT[column],
                  borderRadius: "var(--radius)",
                  padding: "0 var(--space-xs)",
                  fontSize: "var(--font-label)",
                }}
              >
                {count}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
