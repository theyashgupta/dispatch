import { createLazyFileRoute } from "@tanstack/react-router";
import { CalendarView } from "@/modules/calendar";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/calendar/{-$id}")({
  component: CalendarRoute,
});

function CalendarRoute() {
  const props = useAppState().calendar;
  return <CalendarView {...props} />;
}
