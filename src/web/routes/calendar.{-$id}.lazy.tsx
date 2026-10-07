import { createLazyFileRoute } from "@tanstack/react-router";
import { CalendarView } from "@/modules/calendar";

export const Route = createLazyFileRoute("/calendar/{-$id}")({
  component: CalendarView,
});
