import { createLazyFileRoute } from "@tanstack/react-router";
import { ArchiveView } from "@/modules/archive";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/archive/{-$id}")({
  component: ArchiveRoute,
});

function ArchiveRoute() {
  const props = useAppState().archive;
  return <ArchiveView {...props} />;
}
