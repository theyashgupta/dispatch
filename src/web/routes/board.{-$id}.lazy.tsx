import { createLazyFileRoute } from "@tanstack/react-router";
import { Board } from "@/features/board";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/board/{-$id}")({
  component: BoardRoute,
});

function BoardRoute() {
  const props = useAppState().board;
  return <Board {...props} />;
}
