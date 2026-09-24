import { useState, type CSSProperties } from "react";
import type { ActivityEvent } from "../../../shared/types.js";
import { Chip } from "../../primitives/Chip.js";
import { Collapsible } from "../../primitives/Collapsible.js";
import { ActivityList } from "./ActivityList.js";
import {
  filterEvents,
  groupEventsByDay,
  type ActivityFilter,
} from "./activity-groups.js";

interface ActivityPageProps {
  events: ActivityEvent[];
  identifiers?: Record<string, string>;
  filter: ActivityFilter;
  onSelectCard: (cardId: string) => void;
}

const pageStyle: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  padding: "var(--space-sm) var(--space-lg)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
};

const emptyStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  padding: "var(--space-xl)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  fontStyle: "italic",
  color: "var(--text-muted)",
};

export function ActivityPage({
  events,
  identifiers,
  filter,
  onSelectCard,
}: ActivityPageProps) {
  const [now] = useState(() => Date.now());
  const groups = groupEventsByDay(filterEvents(events, filter), now);
  return (
    <div
      className="scroll-stable-y"
      aria-live="polite"
      aria-relevant="additions"
      style={pageStyle}
    >
      {groups.length === 0 ? (
        <div style={emptyStyle}>
          {events.length === 0 ? "No activity yet." : "No matching activity."}
        </div>
      ) : (
        groups.map((group) => (
          <Collapsible
            key={group.dayKey}
            title={group.label}
            badge={<Chip>{group.events.length}</Chip>}
            defaultOpen
          >
            <ActivityList
              events={group.events}
              identifiers={identifiers}
              onSelectCard={onSelectCard}
            />
          </Collapsible>
        ))
      )}
    </div>
  );
}
