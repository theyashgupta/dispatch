import type { Column as ColumnId } from "../../../shared/types.js";
import { Glyph } from "../../primitives/Glyph.js";
import { Button } from "../../primitives/Button.js";

interface EmptyStateProps {
  column: ColumnId;
  inboxCount?: number;
  onOpenInbox?: () => void;
}

export const SINGLE_LINE_COPY: Record<Exclude<ColumnId, "todo">, string> = {
  in_progress: "Nothing running.",
  needs_input: "Nothing waiting on your input.",
  agent_done: "No finished agents yet.",
  in_review: "Nothing waiting on you.",
  done: "Finished tickets land here.",
  inbox: "Nothing in the inbox.",
};

export function EmptyState({
  column,
  inboxCount,
  onOpenInbox,
}: EmptyStateProps) {
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

  const waiting = inboxCount != null && inboxCount > 0 ? inboxCount : 0;

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
        {waiting > 0 ? (
          <>
            {waiting} ticket{waiting === 1 ? "" : "s"} waiting in the Inbox for
            triage.
          </>
        ) : (
          <>
            New tickets synced from Linear land in the Inbox for triage, not
            directly here. Promote what you want to work on next.
          </>
        )}
        <br />
        Or click + above to draft one yourself.
      </div>
      {waiting > 0 && (
        <Button
          variant="primary"
          onClick={onOpenInbox}
          style={{ alignSelf: "center" }}
        >
          Open Inbox: {waiting} waiting
        </Button>
      )}
    </div>
  );
}
