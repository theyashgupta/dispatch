import { createLazyFileRoute } from "@tanstack/react-router";
import { ActivityPage } from "@/features/activity";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/activity/{-$id}")({
  component: ActivityRoute,
});

function ActivityRoute() {
  const props = useAppState().activity;
  return <ActivityPage {...props} />;
}
