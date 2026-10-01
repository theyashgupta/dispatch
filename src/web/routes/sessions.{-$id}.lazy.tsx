import { createLazyFileRoute } from "@tanstack/react-router";
import { SessionsPage } from "@/features/sessions";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/sessions/{-$id}")({
  component: SessionsRoute,
});

function SessionsRoute() {
  const props = useAppState().sessions;
  return <SessionsPage {...props} />;
}
