import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { cardIdentifiers } from "../../../../shared/card-identifiers.js";
import { pinFromBoard } from "../../../../shared/pinned-card.js";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { ActivityEmpty } from "@/modules/activity/components/ActivityEmpty";
import { ActivityRowList } from "@/modules/activity/components/ActivityRowList";
import { useTickingNow } from "@/modules/activity/hooks/use-ticking-now";
import { activityFeedQueryOptions } from "@/queries/activity-queries";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";

export function ActivityListContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const board = useBoardSnapshot(useAppStore(appStore, (s) => s.doneLimit));
  const ticking = useAppStore(appStore, (s) => s.activityOpen);
  const { data: events = [] } = useQuery({
    ...activityFeedQueryOptions(),
    refetchOnMount: false,
  });
  const now = useTickingNow(ticking);

  if (events.length === 0) {
    return <ActivityEmpty>No activity yet.</ActivityEmpty>;
  }

  return (
    <ActivityRowList
      events={events}
      identifiers={cardIdentifiers(board?.cards ?? [])}
      onSelectCard={(id) => {
        appStore.selectCard(id, pinFromBoard(id, board?.cards ?? []));
        appStore.setActivityOpen(false);
      }}
      now={now}
    />
  );
}
