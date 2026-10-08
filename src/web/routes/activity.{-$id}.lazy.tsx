import { createLazyFileRoute } from "@tanstack/react-router";
import { ActivityView } from "@/modules/activity";

export const Route = createLazyFileRoute("/activity/{-$id}")({
  component: ActivityView,
});
