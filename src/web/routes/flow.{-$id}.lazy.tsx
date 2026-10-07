import { createLazyFileRoute } from "@tanstack/react-router";
import { FlowView } from "@/modules/flow";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/flow/{-$id}")({
  component: FlowRoute,
});

function FlowRoute() {
  const props = useAppState().flow;
  return <FlowView {...props} />;
}
