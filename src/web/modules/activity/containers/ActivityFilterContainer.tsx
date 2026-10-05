import type { ActivityEvent } from "../../../../shared/types.js";
import { ActivityFilterBar } from "@/modules/activity/components/ActivityFilterBar";
import { activityFilterOptions } from "@/modules/activity/domain/activity-filter-options";
import type { ActivityFilter } from "@/modules/activity/domain/activity-groups";

export interface ActivityFilterContainerProps {
  events: ActivityEvent[];
  identifiers: Record<string, string>;
  filter: ActivityFilter;
  onFilterChange: (filter: ActivityFilter) => void;
}

export function ActivityFilterContainer({
  events,
  identifiers,
  filter,
  onFilterChange,
}: ActivityFilterContainerProps) {
  const { cardOptions, typeOptions } = activityFilterOptions(
    events,
    filter,
    identifiers,
  );
  return (
    <ActivityFilterBar
      cardOptions={cardOptions}
      typeOptions={typeOptions}
      filter={filter}
      onFilterChange={onFilterChange}
    />
  );
}
