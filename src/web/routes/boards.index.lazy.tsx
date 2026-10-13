import { createLazyFileRoute } from "@tanstack/react-router";
import { BoardsView } from "@/modules/boards";

export const Route = createLazyFileRoute("/boards/")({
  component: BoardsView,
});
