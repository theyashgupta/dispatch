import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const searchSchema = z.looseObject({
  dialog: z.literal("new").optional().catch(undefined),
});

export const Route = createFileRoute("/boards/{-$id}")({
  validateSearch: (search) => searchSchema.parse(search),
});
