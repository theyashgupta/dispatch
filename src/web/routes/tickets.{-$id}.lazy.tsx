import { createLazyFileRoute } from "@tanstack/react-router";
import { TicketsView } from "@/modules/tickets";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/tickets/{-$id}")({
  component: TicketsRoute,
});

function TicketsRoute() {
  const props = useAppState().tickets;
  return <TicketsView {...props} />;
}
