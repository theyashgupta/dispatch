import { useNavigate } from "@tanstack/react-router";
import type { BoardKey } from "../../../../shared/types.js";

/** Navigation of the boards pages: the create dialog parameter, "Open board", the settings page and the archive redirect. */
export function useBoardsNavigation() {
  const navigate = useNavigate();
  return {
    openCreateDialog: () =>
      void navigate({
        to: "/boards",
        search: (prev) => ({ ...prev, dialog: "new" }),
      }),
    closeCreateDialog: () =>
      void navigate({
        to: "/boards",
        search: (prev) => ({ ...prev, dialog: undefined }),
        replace: true,
      }),
    openBoard: (key: BoardKey) =>
      void navigate({ to: "/boards/$key", params: { key } }),
    openSettings: (key: BoardKey) =>
      void navigate({ to: "/boards/$key/settings", params: { key } }),
    leaveBoard: () =>
      void navigate({
        to: "/boards",
        search: (prev) => ({ ...prev, board: undefined }),
        replace: true,
      }),
  };
}
