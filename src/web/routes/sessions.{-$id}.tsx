import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/sessions/{-$id}")({
  pendingMs: Infinity,
  beforeLoad: ({ context, params, search }) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({
      to: "/boards/$key/sessions/{-$id}",
      params: { key: context.board, id: params.id },
      search: { ...search, board: undefined },
      replace: true,
    });
  },
});
