import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { cardIdentifiers } from "../../../../shared/card-identifiers.js";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { ActivityFilterBar } from "@/modules/activity/components/ActivityFilterBar";
import { activityFilterOptions } from "@/modules/activity/domain/activity-filter-options";
import { useActivityFilter } from "@/modules/activity/hooks/use-activity-filter";
import { activityFeedQueryOptions } from "@/queries/activity-queries";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";

export function ActivityFilterContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const board = useBoardSnapshot(useAppStore(appStore, (s) => s.doneLimit));
  const { data } = useQuery({
    ...activityFeedQueryOptions(),
    refetchOnMount: false,
  });
  const [filter, setFilter] = useActivityFilter();
  const { cardOptions, typeOptions } = activityFilterOptions(
    data ?? [],
    filter,
    cardIdentifiers(board?.cards ?? []),
  );
  return (
    <ActivityFilterBar
      cardOptions={cardOptions}
      typeOptions={typeOptions}
      filter={filter}
      onFilterChange={setFilter}
    />
  );
}
