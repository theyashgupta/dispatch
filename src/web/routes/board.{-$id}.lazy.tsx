import { createLazyFileRoute } from "@tanstack/react-router";
import { BoardView } from "@/modules/board";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/board/{-$id}")({
  component: BoardRoute,
});

function BoardRoute() {
  const props = useAppState().board;
  return <BoardView {...props} />;
}
