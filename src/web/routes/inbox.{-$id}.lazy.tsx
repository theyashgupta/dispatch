import { createLazyFileRoute } from "@tanstack/react-router";
import { InboxView } from "@/features/inbox";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/inbox/{-$id}")({
  component: InboxRoute,
});

function InboxRoute() {
  const props = useAppState().inbox;
  return <InboxView {...props} />;
}
