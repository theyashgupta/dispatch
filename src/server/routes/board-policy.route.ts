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
 * The board policy fields, all required; the fixed supervisor values are not settings.
 *
 * @remarks
 * The two models are checked against the shared list, and `opus` stays valid as the legacy name of Opus 5.5.
 */
const policyBodySchema = z
  .strictObject(
    {
      roadmapApproval: z.enum(
        ["ask", "rules", "all"],
        "invalid-roadmapApproval",
      ),
      concurrencyCap: whole("concurrencyCap", 1, 20),
      loopModel: z
        .string("invalid-loopModel")
        .refine(isLoopModel, "invalid-loopModel")
        .nullable(),
      orchestratorModel: z
        .string("invalid-orchestratorModel")
        .refine(isOrchestratorModel, "invalid-orchestratorModel"),
      handoffPercent: whole("handoffPercent", 1, 100),
      handoffHardPercent: whole("handoffHardPercent", 1, 100),
      usageLimit: z.enum(["wait", "stop"], "invalid-usageLimit"),
      shipRights: z.enum(["none", "open_prs", "merge"], "invalid-shipRights"),
      budgetPerGroup: z
        .number("invalid-budgetPerGroup")
        .positive("invalid-budgetPerGroup")
        .max(100_000, "invalid-budgetPerGroup")
        .nullable(),
      supervisor: z.enum(["on", "off"], "invalid-supervisor"),
    },
    { error: unknownFieldError("invalid-policy") },
  )
  .refine((p) => p.handoffHardPercent >= p.handoffPercent, {
    message: "hard-below-handoff",
    path: ["handoffHardPercent"],
  });

boardPolicyRouter.put("/boards/:key/policy", async (req, res) => {
  const key = parseBoardKeyParam(req.params.key);
  const policy = parseOrThrow(policyBodySchema, req.body);
  res.status(200).json({ board: await setBoardPolicy(key, policy) });
});

boardPolicyRouter.use(httpErrorHandler);
