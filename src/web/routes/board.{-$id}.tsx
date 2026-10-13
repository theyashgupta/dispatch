import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/board/{-$id}")({
  pendingMs: Infinity,
  beforeLoad: ({ context, search }) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({
      to: "/boards/$key",
      params: { key: context.board },
      search: { ...search, board: undefined },
      replace: true,
    });
  },
});
