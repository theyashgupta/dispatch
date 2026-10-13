import { createLazyFileRoute } from "@tanstack/react-router";
import { CentreView } from "@/modules/orchestrator";

export const Route = createLazyFileRoute("/boards/$key/orchestrator/{-$id}")({
  component: CentreView,
});
