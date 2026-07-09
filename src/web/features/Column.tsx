import { useDroppable } from "@dnd-kit/core";
import type {
  Card as CardModel,
  Column as ColumnId,
} from "../../shared/types.js";
import { Card } from "./Card.js";
import { EmptyState } from "./EmptyState.js";

const COLUMN_LABELS: Record<ColumnId, string> = {
  todo: "TO DO",
  in_progress: "IN PROGRESS",
  needs_input: "NEEDS INPUT",
  agent_done: "AGENT DONE",
  in_review: "IN REVIEW",
  done: "DONE",
};

const COLUMN_ACCENT: Record<ColumnId, string> = {
  todo: "var(--col-todo)",
  in_progress: "var(--col-in-progress)",
  needs_input: "var(--col-needs-input)",
  agent_done: "var(--col-agent-done)",
  in_review: "var(--col-in-review)",
  done: "var(--col-done)",
};

interface ColumnProps {
  column: ColumnId;
  cards: CardModel[];
  selectedCardId?: string | null;
  onSelectCard?: (id: string) => void;
  onStartRequest?: (id: string) => void;
  isCarousel?: boolean;
  phone?: boolean;
  large?: boolean;
}

export function Column({
  column,
  cards,
  selectedCardId,
  onSelectCard,
  onStartRequest,
  isCarousel,
  phone,
  large,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column });

  const sizing = isCarousel
    ? {
        flex: phone ? "0 0 90vw" : "0 0 80vw",
        scrollSnapAlign: "start" as const,
      }
    : large
      ? { flex: "1 1 0", minWidth: "240px", maxWidth: "360px" }
      : { flex: "1 1 0", minWidth: "220px" };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...sizing,
        display: "flex",
        flexDirection: "column",
        background: isOver
          ? "color-mix(in srgb, var(--accent) 12%, var(--surface-column))"
          : "var(--surface-column)",
        border: isOver ? "1px solid var(--accent)" : "1px solid transparent",
        borderRadius: "var(--radius)",
        padding: "0 var(--space-lg) var(--space-lg)",
        overflow: "hidden",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          height: "var(--column-header-height)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs)",
          background: "var(--surface-column)",
          fontSize: "var(--font-label)",
          fontWeight: "var(--weight-semibold)",
          lineHeight: "var(--line-label)",
          letterSpacing: "0.04em",
          color: "var(--text-muted)",
          userSelect: "none",
        }}
      >
        <span
          style={{
            borderBottom: `2px solid ${COLUMN_ACCENT[column]}`,
            paddingBottom: "2px",
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

      <div
        style={{
          flex: "1 1 auto",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-sm)",
        }}
      >
        {cards.length === 0 ? (
          <EmptyState column={column} />
        ) : (
          cards.map((card) => (
            <Card
              key={card.id}
              card={card}
              selected={card.id === selectedCardId}
              onSelect={onSelectCard}
              onStartRequest={onStartRequest}
            />
          ))
        )}
      </div>
    </div>
  );
}
