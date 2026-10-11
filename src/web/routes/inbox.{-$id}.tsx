import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/inbox/{-$id}")({
  pendingMs: Infinity,
  beforeLoad: ({ context, params, search }) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({
      to: "/boards/$key/inbox/{-$id}",
      params: { key: context.board, id: params.id },
      search: { ...search, board: undefined },
      replace: true,
    });
  },
});
