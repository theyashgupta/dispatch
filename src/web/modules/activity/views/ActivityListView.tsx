import {
  ActivityListContainer,
  type ActivityListContainerProps,
} from "@/modules/activity/containers/ActivityListContainer";

export function ActivityListView(props: ActivityListContainerProps) {
  return <ActivityListContainer {...props} />;
}
