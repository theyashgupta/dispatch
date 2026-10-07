import { createLazyFileRoute } from "@tanstack/react-router";
import { TodayView } from "@/modules/today";

export const Route = createLazyFileRoute("/today/{-$id}")({
  component: TodayView,
});
