import { createLazyFileRoute } from "@tanstack/react-router";
import { FlowView } from "@/modules/flow";

export const Route = createLazyFileRoute("/flow/{-$id}")({
  component: FlowView,
});
