import { createLazyFileRoute } from "@tanstack/react-router";
import { FlowPage } from "@/features/flow";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/flow/{-$id}")({
  component: FlowRoute,
});

function FlowRoute() {
  const props = useAppState().flow;
  return <FlowPage {...props} />;
}
