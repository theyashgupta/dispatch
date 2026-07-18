import { useState } from "react";
import type { BoardSnapshot, Column } from "../../../shared/types.js";
import { OrcaSection } from "./OrcaSection.js";
import { ORCA_SECTIONS, groupCardsByColumn } from "./orca-selectors.js";

interface OrcaViewProps {
  board: BoardSnapshot;
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
}

export function OrcaView({
  board,
  selectedCardId,
  onSelectCard,
}: OrcaViewProps) {
  const [collapsedSections, setCollapsedSections] = useState<Set<Column>>(
    new Set(),
  );
  const grouped = groupCardsByColumn(board.cards);

  function toggleSection(column: Column) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(column)) {
        next.delete(column);
      } else {
        next.add(column);
      }
      return next;
    });
  }

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
      >
        {ORCA_SECTIONS.map((column) => (
          <OrcaSection
            key={column}
            column={column}
            cards={grouped.get(column) ?? []}
            collapsed={collapsedSections.has(column)}
            onToggle={() => toggleSection(column)}
            selectedCardId={selectedCardId}
            onSelectCard={onSelectCard}
          />
        ))}
      </nav>
    </div>
  );
}
