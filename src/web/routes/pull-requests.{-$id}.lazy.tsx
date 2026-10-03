import { createLazyFileRoute } from "@tanstack/react-router";
import { PullRequestsView } from "@/modules/pull-requests";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/pull-requests/{-$id}")({
  component: PullRequestsRoute,
});

function PullRequestsRoute() {
  const props = useAppState()["pull-requests"];
  const { id } = Route.useParams();
  return <PullRequestsView {...props} selectedKey={id ?? null} />;
}
