import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { legacyPanelRedirect } from "../../shared/orchestrator-settings.js";

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
  beforeLoad: ({ params, search }) => {
    const target = legacyPanelRedirect(search);
    if (target === null) return;
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack redirect is thrown by design
    throw redirect({
      to: "/boards/$key/orchestrator/{-$id}",
      params: { key: params.key },
      search: { settings: target.settings },
      replace: true,
    });
  },
});
