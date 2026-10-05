import type { ActivityEvent } from "../../../../shared/types.js";
import { ActivityEmpty } from "@/modules/activity/components/ActivityEmpty";
import { ActivityRowList } from "@/modules/activity/components/ActivityRowList";
import { useTickingNow } from "@/modules/activity/hooks/use-ticking-now";

export interface ActivityListContainerProps {
  events: ActivityEvent[];
  identifiers?: Record<string, string>;
  onSelectCard: (cardId: string) => void;
  ticking?: boolean;
}

export function ActivityListContainer({
  events,
  identifiers,
  onSelectCard,
  ticking = true,
}: ActivityListContainerProps) {
  const now = useTickingNow(ticking);

  if (events.length === 0) {
    return <ActivityEmpty>No activity yet.</ActivityEmpty>;
  }

  return (
    <ActivityRowList
      events={events}
      identifiers={identifiers}
      onSelectCard={onSelectCard}
      now={now}
    />
  );
}
