import { createLazyFileRoute } from "@tanstack/react-router";
import { BoardView } from "@/modules/board";

export const Route = createLazyFileRoute("/board/{-$id}")({
  component: BoardView,
});
