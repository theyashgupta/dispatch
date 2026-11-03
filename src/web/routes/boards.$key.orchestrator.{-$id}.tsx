import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  CENTRE_VIEWS,
  ORCHESTRATOR_SETTINGS_TABS,
} from "../../shared/orchestrator-settings.js";

const searchSchema = z.looseObject({
  settings: z.enum(ORCHESTRATOR_SETTINGS_TABS).optional().catch(undefined),
  view: z.enum(CENTRE_VIEWS).optional().catch(undefined),
});

export const Route = createFileRoute("/boards/$key/orchestrator/{-$id}")({
  pendingMs: 1000,
  validateSearch: (search) => searchSchema.parse(search),
});
