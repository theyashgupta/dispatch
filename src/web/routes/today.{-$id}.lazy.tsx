import { createLazyFileRoute } from "@tanstack/react-router";
import { TodayView } from "@/modules/today";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/today/{-$id}")({
  component: TodayRoute,
});

function TodayRoute() {
  const props = useAppState().today;
  return <TodayView {...props} />;
}
