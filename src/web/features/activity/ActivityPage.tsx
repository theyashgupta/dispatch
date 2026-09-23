import type { ActivityEvent } from "../../../shared/types.js";
import { ActivityList } from "./ActivityList.js";

interface ActivityPageProps {
  events: ActivityEvent[];
  identifiers?: Record<string, string>;
  onSelectCard: (cardId: string) => void;
}

export function ActivityPage({
  events,
  identifiers,
  onSelectCard,
}: ActivityPageProps) {
  return (
    <div
      className="scroll-stable-y"
      aria-live="polite"
      aria-relevant="additions"
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        overflowY: "auto",
        padding: "var(--space-sm) 0",
      }}
    >
      <ActivityList
        events={events}
        identifiers={identifiers}
        onSelectCard={onSelectCard}
      />
    </div>
  );
}
