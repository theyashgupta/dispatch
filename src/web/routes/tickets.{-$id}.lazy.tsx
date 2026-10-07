import { createLazyFileRoute } from "@tanstack/react-router";
import { TicketsView } from "@/modules/tickets";

export const Route = createLazyFileRoute("/tickets/{-$id}")({
  component: TicketsView,
});
