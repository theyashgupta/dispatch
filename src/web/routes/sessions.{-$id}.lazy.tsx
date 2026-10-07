import { createLazyFileRoute } from "@tanstack/react-router";
import { SessionsView } from "@/modules/sessions";

export const Route = createLazyFileRoute("/sessions/{-$id}")({
  component: SessionsView,
});
