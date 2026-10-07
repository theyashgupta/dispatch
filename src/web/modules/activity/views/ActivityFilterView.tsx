import { PageHeaderActions } from "@/components/PageHeaderActions";
import { ActivityFilterContainer } from "@/modules/activity/containers/ActivityFilterContainer";

export function ActivityFilterView() {
  return (
    <PageHeaderActions>
      <ActivityFilterContainer />
    </PageHeaderActions>
  );
}
