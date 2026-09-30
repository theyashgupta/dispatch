import { createLazyFileRoute } from "@tanstack/react-router";
import { TicketsPage } from "@/features/tickets";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/tickets/{-$id}")({
  component: TicketsRoute,
});

function TicketsRoute() {
  const props = useAppState().tickets;
  return <TicketsPage {...props} />;
}
