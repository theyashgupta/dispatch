import { createLazyFileRoute } from "@tanstack/react-router";
import { ActivityView } from "@/modules/activity";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/activity/{-$id}")({
  component: ActivityRoute,
});

function ActivityRoute() {
  const props = useAppState().activity;
  return <ActivityView {...props} />;
}
