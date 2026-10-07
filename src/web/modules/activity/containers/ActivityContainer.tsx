import { useEffect, useMemo, useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import type { ActivityEvent } from "../../../../shared/types.js";
import { cardIdentifiers } from "../../../../shared/card-identifiers.js";
import { nowMs } from "../../../../shared/format-age.js";
import { pinFromBoard } from "../../../../shared/pinned-card.js";
import { GroupCollapsible } from "@/components/GroupCollapsible";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { stampLastOpened } from "@/components/ui/hooks/use-last-opened";
import { ActivityEmpty } from "@/modules/activity/components/ActivityEmpty";
import { ActivityFeed } from "@/modules/activity/components/ActivityFeed";
import { ActivityRowList } from "@/modules/activity/components/ActivityRowList";
import {
  filterEvents,
  groupEventsByDay,
} from "@/modules/activity/domain/activity-groups";
import { useActivityFilter } from "@/modules/activity/hooks/use-activity-filter";
import { useTickingNow } from "@/modules/activity/hooks/use-ticking-now";
import { useActivityFeedQuery } from "@/queries/activity-queries";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";

const NO_EVENTS: ActivityEvent[] = [];

export function ActivityContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const boardKey = useAppStore(appStore, (s) => s.board);
  const board = useBoardSnapshot(
    boardKey,
    useAppStore(appStore, (s) => s.doneLimit),
  );
  const { data } = useActivityFeedQuery(boardKey, { refetchOnMount: false });
  const events = data ?? NO_EVENTS;
  const identifiers = cardIdentifiers(board?.cards ?? []);
  const [filter] = useActivityFilter();
  const [mountedAt] = useState(() => nowMs());
  const now = useTickingNow(true);
  const groups = useMemo(
    () => groupEventsByDay(filterEvents(events, filter), mountedAt),
    [events, filter, mountedAt],
  );

  useEffect(() => {
    stampLastOpened("__feed__");
  }, [events.length]);

  const onSelectCard = (id: string) =>
    appStore.selectCard(id, pinFromBoard(id, board?.cards ?? []));

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
