import type { ComponentProps } from "react";
import { PullRequestsContainer } from "@/modules/pull-requests/containers/PullRequestsContainer";

export function PullRequestsView(
  props: ComponentProps<typeof PullRequestsContainer>,
) {
  return <PullRequestsContainer {...props} />;
}
