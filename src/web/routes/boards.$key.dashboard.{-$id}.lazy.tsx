import { createLazyFileRoute } from "@tanstack/react-router";
import { DashboardView } from "@/modules/dashboard";

export const Route = createLazyFileRoute("/boards/$key/dashboard/{-$id}")({
  component: DashboardView,
});
