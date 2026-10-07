import {
  ActivityFilterContainer,
  type ActivityFilterContainerProps,
} from "@/modules/activity/containers/ActivityFilterContainer";

export function ActivityFilterView(props: ActivityFilterContainerProps) {
  return <ActivityFilterContainer {...props} />;
}
