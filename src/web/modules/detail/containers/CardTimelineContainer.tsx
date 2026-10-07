import type { ActivityEvent, BoardKey } from "../../../../shared/types.js";
import { CardTimeline } from "@/modules/detail/components/CardTimeline";
import { useCardEventsQuery } from "@/modules/detail/queries/detail-queries";

interface CardTimelineContainerProps {
  board: BoardKey;
  cardId: string;
  events: ActivityEvent[];
  identifiers?: Record<string, string>;
}

export function CardTimelineContainer({
  board,
  cardId,
  events,
  identifiers,
}: CardTimelineContainerProps) {
  const backfill = useCardEventsQuery(board, cardId);
  return (
    <CardTimeline
      cardId={cardId}
      events={events}
      backfill={backfill.data ?? []}
      identifiers={identifiers}
    />
  );
}
