import { createLazyFileRoute } from "@tanstack/react-router";
import { PullRequestsPage } from "@/features/pull-requests";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/pull-requests/{-$id}")({
  component: PullRequestsRoute,
});

function PullRequestsRoute() {
  const props = useAppState()["pull-requests"];
  const { id } = Route.useParams();
  return <PullRequestsPage {...props} selectedKey={id ?? null} />;
}
