import { createLazyFileRoute } from "@tanstack/react-router";
import { WorkspacesView } from "@/modules/workspaces";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/workspaces/{-$id}")({
  component: WorkspacesRoute,
});

function WorkspacesRoute() {
  const props = useAppState().workspaces;
  return <WorkspacesView {...props} />;
}
