import { createLazyFileRoute } from "@tanstack/react-router";
import { SessionsView } from "@/modules/sessions";

export const Route = createLazyFileRoute("/boards/$key/sessions/{-$id}")({
  component: SessionsView,
});
