import { createLazyFileRoute } from "@tanstack/react-router";
import { SlackView } from "@/modules/slack";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/slack/{-$id}")({
  component: SlackRoute,
});

function SlackRoute() {
  const props = useAppState().slack;
  const { id } = Route.useParams();
  return <SlackView {...props} selectedId={id ?? null} />;
}
