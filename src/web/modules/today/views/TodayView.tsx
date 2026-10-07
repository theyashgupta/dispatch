import { PageBody } from "@/components/PageBody";
import {
  TodayContainer,
  type TodayContainerProps,
} from "@/modules/today/containers/TodayContainer";

export function TodayView(props: TodayContainerProps) {
  return (
    <PageBody>
      <TodayContainer {...props} />
    </PageBody>
  );
}
