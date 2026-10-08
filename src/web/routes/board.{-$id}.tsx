import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const searchSchema = z.looseObject({
  panel: z.literal("orchestrator").optional().catch(undefined),
});

export const Route = createFileRoute("/board/{-$id}")({
  validateSearch: (search) => searchSchema.parse(search),
});
