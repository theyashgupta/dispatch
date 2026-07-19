import { useState, type CSSProperties } from "react";
import type { BoardSnapshot } from "../../../shared/types.js";
import { moveCard } from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Glyph } from "../../primitives/Glyph.js";
import { InboxToolbar } from "./InboxToolbar.js";
import { InboxRow } from "./InboxRow.js";
import { inboxProjectOptions, matchesSearch } from "./inbox-filters.js";

interface InboxViewProps {
  board: BoardSnapshot;
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
}

const emptyBlockStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  padding: "var(--space-3xl) 0",
  textAlign: "center",
};

const emptyHeadingStyle: CSSProperties = {
  fontSize: "var(--font-body)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
};

const emptyBodyStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

export function InboxView({
  board,
  selectedCardId,
  onSelectCard,
}: InboxViewProps) {
  const [search, setSearch] = useState("");
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

  const inboxCards = board.cards
    .filter((c) => c.column === "inbox")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const projectOptions = inboxProjectOptions(board.cards);

  const visibleCards = inboxCards.filter((c) => {
    if (!matchesSearch(c, search)) return false;
    if (selectedProjectIds.length > 0) {
      if (c.project == null || !selectedProjectIds.includes(c.project.id)) {
        return false;
      }
    }
    return true;
  });

  function handlePromote(id: string) {
    moveCard(id, "todo").catch((err) => {
      console.error("moveCard failed; SSE snapshot will reconcile", err);
    });
  }

  function handleClearFilters() {
    setSearch("");
    setSelectedProjectIds([]);
  }

  return (
    <div
      id="inbox-view"
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <InboxToolbar
        search={search}
        onSearchChange={setSearch}
        projectOptions={projectOptions}
        selectedProjectIds={selectedProjectIds}
        onProjectsChange={setSelectedProjectIds}
        visibleCount={visibleCards.length}
        totalCount={inboxCards.length}
      />
      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
        {inboxCards.length === 0 ? (
          <div style={emptyBlockStyle}>
            <Glyph size={48} style={{ opacity: 0.08, alignSelf: "center" }} />
            <div style={emptyHeadingStyle}>Inbox is empty</div>
            <div style={emptyBodyStyle}>
              Synced Linear tickets you haven't triaged yet will show up here.
            </div>
          </div>
        ) : visibleCards.length === 0 ? (
          <div style={emptyBlockStyle}>
            <div style={emptyHeadingStyle}>No matching tickets</div>
            <div style={emptyBodyStyle}>
              Try a different search or clear your filters.
            </div>
            <Button
              variant="secondary"
              onClick={handleClearFilters}
              style={{ alignSelf: "center" }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          visibleCards.map((card) => (
            <InboxRow
              key={card.id}
              card={card}
              selected={card.id === selectedCardId}
              onSelect={onSelectCard}
              onPromote={handlePromote}
            />
          ))
        )}
      </div>
    </div>
  );
}
