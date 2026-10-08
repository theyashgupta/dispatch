import { useMemo, useState } from "react";
import { ActivitySection } from "@/modules/dashboard/components/ActivitySection";
import {
  ACTIVITY_PAGE_SIZE,
  activityRows,
  type ActivityActorFilter,
} from "@/modules/dashboard/domain/activity-rows";
import { sectionState } from "@/modules/dashboard/domain/section-state";
import { groupOptions } from "@/modules/dashboard/domain/tickets-by-column";
import { retryFailed, useDashboardData } from "./use-dashboard-data";

const ALL = "all";

export function ActivityContainer() {
  const { snapshot, events, orchestrators } = useDashboardData();
  const [actor, setActor] = useState<ActivityActorFilter>("all");
  const [groupValue, setGroupValue] = useState(ALL);
  const [shown, setShown] = useState(ACTIVITY_PAGE_SIZE);
  const cards = snapshot.data?.cards;
  const rows = useMemo(
    () =>
      activityRows(events.data ?? [], cards ?? [], {
        actor,
        groupId: groupValue === ALL ? undefined : groupValue,
        orchestrators,
      }),
    [events.data, cards, actor, groupValue, orchestrators],
  );
  const groups = useMemo(() => groupOptions(cards ?? []), [cards]);
  return (
    <ActivitySection
      state={sectionState([snapshot, events])}
      rows={rows.slice(0, shown)}
      total={events.data?.length ?? 0}
      hasMore={rows.length > shown}
      actorValue={actor}
      groupValue={groupValue}
      groups={groups}
      onActorChange={(value) => {
        setActor(value);
        setShown(ACTIVITY_PAGE_SIZE);
      }}
      onGroupChange={(value) => {
        setGroupValue(value);
        setShown(ACTIVITY_PAGE_SIZE);
      }}
      onShowMore={() => setShown((count) => count + ACTIVITY_PAGE_SIZE)}
      onRetry={() => retryFailed([snapshot, events])}
    />
  );
}
