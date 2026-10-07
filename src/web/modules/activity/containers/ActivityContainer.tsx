import { useMemo, useState } from "react";
import type { ActivityEvent } from "../../../../shared/types.js";
import { nowMs } from "../../../../shared/format-age.js";
import { GroupCollapsible } from "@/components/GroupCollapsible";
import { ActivityEmpty } from "@/modules/activity/components/ActivityEmpty";
import { ActivityFeed } from "@/modules/activity/components/ActivityFeed";
import { ActivityRowList } from "@/modules/activity/components/ActivityRowList";
import {
  filterEvents,
  groupEventsByDay,
  type ActivityFilter,
} from "@/modules/activity/domain/activity-groups";
import { useTickingNow } from "@/modules/activity/hooks/use-ticking-now";

export interface ActivityContainerProps {
  events: ActivityEvent[];
  identifiers?: Record<string, string>;
  filter: ActivityFilter;
  onSelectCard: (cardId: string) => void;
}

export function ActivityContainer({
  events,
  identifiers,
  filter,
  onSelectCard,
}: ActivityContainerProps) {
  const [mountedAt] = useState(() => nowMs());
  const now = useTickingNow(true);
  const groups = useMemo(
    () => groupEventsByDay(filterEvents(events, filter), mountedAt),
    [events, filter, mountedAt],
  );
  return (
    <ActivityFeed>
      {groups.length === 0 ? (
        <ActivityEmpty>
          {events.length === 0 ? "No activity yet." : "No matching activity."}
        </ActivityEmpty>
      ) : (
        groups.map((group) => (
          <GroupCollapsible
            key={group.dayKey}
            label={group.label}
            count={group.events.length}
          >
            <ActivityRowList
              events={group.events}
              identifiers={identifiers}
              onSelectCard={onSelectCard}
              now={now}
            />
          </GroupCollapsible>
        ))
      )}
    </ActivityFeed>
  );
}
