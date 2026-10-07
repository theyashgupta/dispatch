import { createLazyFileRoute } from "@tanstack/react-router";
import { SlackView } from "@/modules/slack";

export const Route = createLazyFileRoute("/slack/{-$id}")({
  component: SlackRoute,
});

function SlackRoute() {
  const { id } = Route.useParams();
  return <SlackView selectedId={id ?? null} />;
}
