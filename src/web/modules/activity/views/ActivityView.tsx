import {
  ActivityContainer,
  type ActivityContainerProps,
} from "@/modules/activity/containers/ActivityContainer";

export function ActivityView(props: ActivityContainerProps) {
  return <ActivityContainer {...props} />;
}
