import { ChevronDown, ChevronRight } from "lucide-react";
import type { Card as CardModel, Column } from "../../../shared/types.js";
import { COLUMN_ACCENT, COLUMN_LABELS } from "../board/Column.js";
import { OrcaNavRow } from "./OrcaNavRow.js";

interface OrcaSectionProps {
  column: Column;
  cards: CardModel[];
  collapsed: boolean;
  onToggle: () => void;
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
}

export function OrcaSection({
  column,
  cards,
  collapsed,
  onToggle,
  selectedCardId,
  onSelectCard,
}: OrcaSectionProps) {
  return (
    <div>
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        style={{
          width: "100%",
          height: "var(--column-header-height)",
          position: "sticky",
          top: 0,
          background: "var(--surface-column)",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--space-lg)",
          border: "none",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-xs)",
          }}
        >
          {collapsed ? (
            <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
          )}
          <span
            style={{
              fontSize: "var(--font-label)",
              fontWeight: "var(--weight-semibold)",
              lineHeight: "var(--line-label)",
              letterSpacing: "0.04em",
              color: "var(--text-muted)",
            }}
          >
            {COLUMN_LABELS[column]}
          </span>
        </span>
        <span
          style={{
            background: `color-mix(in srgb, ${COLUMN_ACCENT[column]} 16%, var(--surface-column))`,
            color: COLUMN_ACCENT[column],
            borderRadius: "var(--radius)",
            padding: "0 var(--space-xs)",
            fontSize: "var(--font-label)",
          }}
        >
          {cards.length}
        </span>
      </button>
      {!collapsed &&
        cards.map((card) => (
          <OrcaNavRow
            key={card.id}
            card={card}
            selected={card.id === selectedCardId}
            onSelect={onSelectCard}
          />
        ))}
    </div>
  );
}
