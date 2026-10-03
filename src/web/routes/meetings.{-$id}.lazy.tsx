import { createLazyFileRoute } from "@tanstack/react-router";
import { MeetingsView } from "@/modules/meetings";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/meetings/{-$id}")({
  component: MeetingsRoute,
});

function MeetingsRoute() {
  const props = useAppState().meetings;
  const { id } = Route.useParams();
  return <MeetingsView {...props} selectedId={id} />;
}
