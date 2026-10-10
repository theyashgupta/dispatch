import { createLazyFileRoute } from "@tanstack/react-router";
import { BoardSettingsView } from "@/modules/boards";

export const Route = createLazyFileRoute("/boards/$key/settings")({
  component: BoardSettingsRoute,
});

function BoardSettingsRoute() {
  const { key } = Route.useParams();
  return <BoardSettingsView boardKey={key} />;
}
