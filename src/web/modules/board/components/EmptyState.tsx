import type { Column as ColumnId } from "../../../../shared/types.js";
import { SINGLE_LINE_COPY } from "../../../../shared/column-empty-copy.js";
import { Glyph } from "@/components/icons/Glyph";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";

interface EmptyStateProps {
  column: ColumnId;
  inboxCount?: number;
  onOpenInbox?: () => void;
}

export function EmptyState({
  column,
  inboxCount,
  onOpenInbox,
}: EmptyStateProps) {
  if (column !== "todo") {
    return (
      <Empty className="flex-none gap-0 p-0 py-(--space-3xl) text-sm font-semibold text-wrap text-muted-foreground select-none md:p-0 md:py-(--space-3xl)">
        {SINGLE_LINE_COPY[column]}
      </Empty>
    );
  }

  const waiting = inboxCount != null && inboxCount > 0 ? inboxCount : 0;

  return (
    <Empty className="flex-none gap-(--space-sm) p-0 py-(--space-3xl) text-wrap md:p-0 md:py-(--space-3xl)">
      <Glyph size={48} className="self-center opacity-8" />
      <div className="text-base font-semibold text-foreground">
        No tickets in To Do
      </div>
      <div className="text-sm text-muted-foreground">
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
        <Button size="sm" className="self-center" onClick={onOpenInbox}>
          Open Inbox: {waiting} waiting
        </Button>
      )}
    </Empty>
  );
}
