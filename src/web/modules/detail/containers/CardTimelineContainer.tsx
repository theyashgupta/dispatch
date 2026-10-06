import type { ActivityEvent } from "../../../../shared/types.js";
import { CardTimeline } from "@/modules/detail/components/CardTimeline";
import { useCardEventsQuery } from "@/modules/detail/queries/detail-queries";

interface CardTimelineContainerProps {
  cardId: string;
  events: ActivityEvent[];
  identifiers?: Record<string, string>;
}

export function CardTimelineContainer({
  cardId,
  events,
  identifiers,
}: CardTimelineContainerProps) {
  const backfill = useCardEventsQuery(cardId);
  return (
    <CardTimeline
      cardId={cardId}
      events={events}
      backfill={backfill.data ?? []}
      identifiers={identifiers}
    />
  );
}
