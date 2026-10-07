import { createLazyFileRoute } from "@tanstack/react-router";
import { ArchiveView } from "@/modules/archive";

export const Route = createLazyFileRoute("/archive/{-$id}")({
  component: ArchiveView,
});
