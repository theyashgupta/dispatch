import { createLazyFileRoute } from "@tanstack/react-router";
import { DashboardView } from "@/modules/dashboard";

export const Route = createLazyFileRoute("/dashboard/{-$id}")({
  component: DashboardView,
});
