import { describeEvent } from "../../../../shared/event-copy.js";
import { formatAge } from "../../../../shared/format-age.js";
import type { ActivityEvent } from "../../../../shared/types.js";
import { ActivityRow } from "@/components/ActivityRow";

interface ActivityRowListProps {
  events: ActivityEvent[];
  identifiers?: Record<string, string>;
  onSelectCard: (cardId: string) => void;
  now: number;
}

export function ActivityRowList({
  events,
  identifiers,
  onSelectCard,
  now,
}: ActivityRowListProps) {
  return (
    <>
      {events.map((event) => (
        <div
          key={event.id}
          className="px-(--space-lg) py-(--space-sm) not-last:border-b not-last:border-border"
        >
          <ActivityRow
            type={event.type}
            cardId={event.cardId ?? undefined}
            description={describeEvent(event)}
            age={formatAge(event.ts, now)}
            identifiers={identifiers}
            onSelect={onSelectCard}
          />
        </div>
      ))}
    </>
  );
}
