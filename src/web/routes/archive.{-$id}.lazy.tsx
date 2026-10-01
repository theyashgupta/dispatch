import { createLazyFileRoute } from "@tanstack/react-router";
import { ArchivePage } from "@/features/archive";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/archive/{-$id}")({
  component: ArchiveRoute,
});

function ArchiveRoute() {
  const props = useAppState().archive;
  return <ArchivePage {...props} />;
}
