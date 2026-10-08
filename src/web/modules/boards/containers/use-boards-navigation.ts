import { useNavigate } from "@tanstack/react-router";
import { boardSearch } from "../../../../shared/board-select.js";
import type { BoardKey } from "../../../../shared/types.js";

/** Navigation of the boards page: the create dialog parameter, "Open board" and the archive redirect. */
export function useBoardsNavigation() {
  const navigate = useNavigate();
  return {
    openCreateDialog: () =>
      void navigate({
        to: "/boards/{-$id}",
        search: (prev) => ({ ...prev, dialog: "new" }),
      }),
    closeCreateDialog: () =>
      void navigate({
        to: "/boards/{-$id}",
        search: (prev) => ({ ...prev, dialog: undefined }),
        replace: true,
      }),
    openBoard: (key: BoardKey) =>
      void navigate({ to: "/board/{-$id}", search: boardSearch(key) }),
    leaveBoard: () =>
      void navigate({
        to: "/boards/{-$id}",
        search: (prev) => ({ ...prev, board: undefined }),
        replace: true,
      }),
  };
}
