import { createModuleState } from "@/components/ui/hooks/module-state";
import type { ActivityFilter } from "@/modules/activity/domain/activity-groups";

export const useActivityFilter = createModuleState<ActivityFilter>({
  cardId: null,
  types: [],
});
