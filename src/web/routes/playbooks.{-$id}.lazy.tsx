import { createLazyFileRoute } from "@tanstack/react-router";
import { PlaybooksPage } from "@/features/playbooks";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/playbooks/{-$id}")({
  component: PlaybooksRoute,
});

function PlaybooksRoute() {
  const props = useAppState().playbooks;
  return <PlaybooksPage {...props} />;
}
