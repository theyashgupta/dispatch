import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/orchestrator/{-$id}")({
  pendingMs: Infinity,
  beforeLoad: ({ context, params, search }) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack redirect is thrown by design
    throw redirect({
      to: "/boards/$key/orchestrator/{-$id}",
      params: { key: context.board, id: params.id },
      search: { ...search, board: undefined },
      replace: true,
    });
  },
});
