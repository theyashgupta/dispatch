import { createLazyFileRoute } from "@tanstack/react-router";
import { MeetingsView } from "@/modules/meetings";

export const Route = createLazyFileRoute("/meetings/{-$id}")({
  component: MeetingsRoute,
});

function MeetingsRoute() {
  const { id } = Route.useParams();
  return <MeetingsView selectedId={id} />;
}
