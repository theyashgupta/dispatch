import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const searchSchema = z.looseObject({
  panel: z.literal("orchestrator").optional().catch(undefined),
  tab: z
    .enum(["terminal", "decisions", "policy", "orchestrators"])
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute("/boards/$key/")({
  pendingMs: 1000,
  validateSearch: (search) => searchSchema.parse(search),
});
