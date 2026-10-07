import { createLazyFileRoute } from "@tanstack/react-router";
import { PullRequestsView } from "@/modules/pull-requests";

export const Route = createLazyFileRoute("/pull-requests/{-$id}")({
  component: PullRequestsRoute,
});

function PullRequestsRoute() {
  const { id } = Route.useParams();
  return <PullRequestsView selectedKey={id ?? null} />;
}
