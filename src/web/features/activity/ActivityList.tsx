import { useEffect, useState, type CSSProperties } from "react";
import type { ActivityEvent } from "../../../shared/types.js";
import { describeEvent } from "../../lib/event-copy.js";
import { formatAge } from "../../lib/format-age.js";
import { ActivityItem } from "../../primitives/ActivityItem.js";

interface ActivityListProps {
  events: ActivityEvent[];
  identifiers?: Record<string, string>;
  onSelectCard: (cardId: string) => void;
  ticking?: boolean;
}

const emptyStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  padding: "var(--space-xl)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  fontStyle: "italic",
  color: "var(--text-muted)",
};

const rowStyle: CSSProperties = {
  padding: "var(--space-sm) var(--space-lg)",
};

export function ActivityList({
  events,
  identifiers,
  onSelectCard,
  ticking = true,
}: ActivityListProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  if (events.length === 0) {
    return <div style={emptyStyle}>No activity yet.</div>;
  }

  return (
    <>
      {events.map((event, index) => (
        <div
          key={event.id}
          style={{
            ...rowStyle,
            borderBottom:
              index < events.length - 1 ? "1px solid var(--border)" : "none",
          }}
        >
          <ActivityItem
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
