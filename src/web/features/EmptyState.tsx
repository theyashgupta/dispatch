import type { Column as ColumnId } from "../../shared/types.js";
import { Glyph } from "../primitives/Glyph.js";

interface EmptyStateProps {
  column: ColumnId;
}

const SINGLE_LINE_COPY: Record<Exclude<ColumnId, "todo">, string> = {
  in_planning: "Nothing being planned.",
  in_progress: "Nothing running.",
  needs_input: "Nothing waiting on your input.",
  agent_done: "No finished agents yet.",
  in_review: "Nothing waiting on you.",
  done: "Finished tickets land here.",
};

export function EmptyState({ column }: EmptyStateProps) {
  if (column !== "todo") {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "var(--space-3xl) 0",
          fontSize: "var(--font-label)",
          fontWeight: "var(--weight-semibold)",
          lineHeight: "var(--line-label)",
          color: "var(--text-muted)",
          userSelect: "none",
        }}
      >
        {SINGLE_LINE_COPY[column]}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
        padding: "var(--space-3xl) 0",
        textAlign: "center",
      }}
    >
      <Glyph size={48} style={{ opacity: 0.08, alignSelf: "center" }} />
      <div
        style={{
          fontSize: "var(--font-body)",
          fontWeight: "var(--weight-semibold)",
          lineHeight: "var(--line-body)",
          color: "var(--text)",
        }}
      >
        No tickets in To Do
      </div>
      <div
        style={{
          fontSize: "var(--font-label)",
          lineHeight: "var(--line-label)",
          color: "var(--text-muted)",
        }}
      >
        Issues assigned to you in Linear that are in an unstarted state show up
        here within a minute.
      </div>
    </div>
  );
}
