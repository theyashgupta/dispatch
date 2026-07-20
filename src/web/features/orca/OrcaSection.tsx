import type { Card as CardModel, Column } from "../../../shared/types.js";
import {
  COLUMN_ACCENT,
  COLUMN_LABELS,
  SINGLE_LINE_COPY,
} from "../board/index.js";
import { OrcaNavRow } from "./OrcaNavRow.js";

interface OrcaSectionProps {
  column: Column;
  cards: CardModel[];
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
}

const ORCA_EMPTY_COPY: Record<Column, string> = {
  ...SINGLE_LINE_COPY,
  todo: "No tickets in To Do.",
};

export function OrcaSection({
  column,
  cards,
  selectedCardId,
  onSelectCard,
}: OrcaSectionProps) {
  return (
    <div>
      <div
        style={{
          height: "var(--column-header-height)",
          position: "sticky",
          top: 0,
          background: "var(--surface-column)",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--space-lg)",
          color: "var(--text-muted)",
        }}
      >
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
      </div>
      {cards.length === 0 ? (
        <div
          style={{
            padding: "var(--space-xs) var(--space-sm)",
            fontSize: "var(--font-label)",
            fontWeight: "var(--weight-regular)",
            color: "var(--text-muted)",
          }}
        >
          {ORCA_EMPTY_COPY[column]}
        </div>
      ) : (
        cards.map((card) => (
          <OrcaNavRow
            key={card.id}
            card={card}
            selected={card.id === selectedCardId}
            onSelect={onSelectCard}
          />
        ))
      )}
    </div>
  );
}
