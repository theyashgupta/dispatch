import { createLazyFileRoute } from "@tanstack/react-router";
import { OrcaView } from "@/features/orca";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/workspace/{-$id}")({
  component: WorkspaceRoute,
});

function WorkspaceRoute() {
  const props = useAppState().workspace;
  return <OrcaView {...props} />;
}
