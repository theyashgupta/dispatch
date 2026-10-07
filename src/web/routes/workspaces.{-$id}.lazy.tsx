import { createLazyFileRoute } from "@tanstack/react-router";
import { WorkspacesView } from "@/modules/workspaces";

export const Route = createLazyFileRoute("/workspaces/{-$id}")({
  component: WorkspacesView,
});
