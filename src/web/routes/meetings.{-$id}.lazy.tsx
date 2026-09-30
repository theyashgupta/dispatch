import { createLazyFileRoute } from "@tanstack/react-router";
import { MeetingsPage } from "@/features/meetings";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/meetings/{-$id}")({
  component: MeetingsRoute,
});

function MeetingsRoute() {
  const props = useAppState().meetings;
  const { id } = Route.useParams();
  return <MeetingsPage {...props} selectedId={id} />;
}
