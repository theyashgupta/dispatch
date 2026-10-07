import type { Card, Column as ColumnId } from "../../../../shared/types.js";
import { DONE_PAGE_SIZE } from "../../../../shared/done-limit.js";
import { Button } from "@/components/ui/button";
import { awaitingCleanup } from "@/modules/board/domain/board-keys";
import { EmptyState } from "./EmptyState";

interface ColumnBodyProps {
  column: ColumnId;
  cards: Card[];
  renderCard: (card: Card) => React.ReactNode;
  inboxCount?: number;
  onOpenInbox?: () => void;
  doneTotal?: number;
  doneLimit?: number;
  onLoadMoreDone?: () => void;
}

export function ColumnBody({
  column,
  cards,
  renderCard,
  inboxCount,
  onOpenInbox,
  doneTotal,
  doneLimit,
  onLoadMoreDone,
}: ColumnBodyProps) {
  if (cards.length === 0) {
    return (
      <EmptyState
        column={column}
        inboxCount={inboxCount}
        onOpenInbox={onOpenInbox}
      />
    );
  }
  if (column !== "done") return <>{cards.map(renderCard)}</>;

  const awaiting = cards.filter(awaitingCleanup);
  const cleaned = cards.filter((c) => !awaitingCleanup(c));
  const doneRemaining = Math.max(0, (doneTotal ?? cards.length) - cards.length);
  const doneBatch = Math.min(DONE_PAGE_SIZE, doneRemaining);
  const doneLoadInFlight =
    doneLimit != null && doneLimit > cards.length && doneRemaining > 0;

  return (
    <>
      {awaiting.map(renderCard)}
      {awaiting.length > 0 && cleaned.length > 0 && (
        <div className="flex items-center gap-(--space-sm) py-(--space-xs)">
          <div className="h-px flex-auto bg-border" />
          <span className="flex-none text-sm font-medium whitespace-nowrap text-muted-foreground">
            Cleaned
          </span>
          <div className="h-px flex-auto bg-border" />
        </div>
      )}
      {cleaned.map(renderCard)}
      {doneRemaining > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="mt-(--space-sm) w-full justify-center"
          disabled={doneLoadInFlight}
          onClick={onLoadMoreDone}
        >
          {doneLoadInFlight
            ? "Loading…"
            : `Load ${doneBatch} more (${doneRemaining} remaining)`}
        </Button>
      )}
    </>
  );
}
