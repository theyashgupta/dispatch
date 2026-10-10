import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

const searchSchema = z.looseObject({
  dialog: z.literal("new").optional().catch(undefined),
});

export const Route = createFileRoute("/boards/{-$id}")({
  validateSearch: (search) => searchSchema.parse(search),
  pendingMs: Infinity,
  beforeLoad: ({ params }) => {
    if (params.id) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({
        to: "/board/{-$id}",
        params: { id: undefined },
        search: { board: params.id },
        replace: true,
      });
    }
  },
});
