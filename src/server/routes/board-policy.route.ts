import { Router } from "express";
import { z } from "zod";
import {
  isLoopModel,
  isOrchestratorModel,
} from "../../shared/orchestrator-models.js";
import { setBoardPolicy } from "../services/orchestration/boards.js";
import { parseBoardKeyParam } from "./boards-schemas.js";
import { httpErrorHandler } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";
import { unknownFieldError } from "./schema-primitives.js";

export const boardPolicyRouter = Router({ caseSensitive: true });

/** An integer field in a range, refused with `invalid-<field>`. */
const whole = (field: string, min: number, max: number) =>
  z
    .number(`invalid-${field}`)
    .int(`invalid-${field}`)
    .min(min, `invalid-${field}`)
    .max(max, `invalid-${field}`);

/**
 * The body of a board policy save.
 *
 * @remarks
 * The two models are checked against the shared list, and `opus` stays valid as the legacy name of Opus 5.5. The number ranges match the policy form and the user guide.
 */
const policyBodySchema = z
  .strictObject(
    {
      roadmapApproval: z.enum(
        ["ask", "rules", "all"],
        "invalid-roadmapApproval",
      ),
      concurrencyCap: whole("concurrencyCap", 1, 10),
      loopModel: z
        .string("invalid-loopModel")
        .refine(isLoopModel, "invalid-loopModel")
        .nullable(),
      orchestratorModel: z
        .string("invalid-orchestratorModel")
        .refine(isOrchestratorModel, "invalid-orchestratorModel"),
      handoffPercent: whole("handoffPercent", 10, 95),
      handoffHardPercent: whole("handoffHardPercent", 1, 100),
      usageLimit: z.enum(["wait", "stop"], "invalid-usageLimit"),
      shipRights: z.enum(["none", "open_prs", "merge"], "invalid-shipRights"),
      budgetPerGroup: z
        .number("invalid-budgetPerGroup")
        .positive("invalid-budgetPerGroup")
        .max(100_000, "invalid-budgetPerGroup")
        .nullable(),
      supervisor: z.enum(["on", "off"], "invalid-supervisor"),
      groupPlaybook: z
        .string("invalid-groupPlaybook")
        .min(1, "invalid-groupPlaybook")
        .refine((s) => s.length <= 200, "invalid-groupPlaybook")
        .nullable()
        .optional(),
      wakeMinutes: whole("wakeMinutes", 0, 1440).optional(),
    },
    { error: unknownFieldError("invalid-policy") },
  )
  .refine((p) => p.handoffHardPercent > p.handoffPercent, {
    message: "hard-below-handoff",
    path: ["handoffHardPercent"],
  });

boardPolicyRouter.put("/boards/:key/policy", async (req, res) => {
  const key = parseBoardKeyParam(req.params.key);
  const body = parseOrThrow(policyBodySchema, req.body);
  res.status(200).json({ board: await setBoardPolicy(key, body) });
});

boardPolicyRouter.use(httpErrorHandler);
