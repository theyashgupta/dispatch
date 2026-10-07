import { createLazyFileRoute } from "@tanstack/react-router";
import { WorkspaceView } from "@/modules/workspace";

export const Route = createLazyFileRoute("/workspace/{-$id}")({
  component: WorkspaceView,
});
