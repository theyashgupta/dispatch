import { createLazyFileRoute } from "@tanstack/react-router";
import { CalendarPage } from "@/features/calendar";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/calendar/{-$id}")({
  component: CalendarRoute,
});

function CalendarRoute() {
  const props = useAppState().calendar;
  return <CalendarPage {...props} />;
}
