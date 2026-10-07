import { Router } from "express";
import { z } from "zod";
import { setBoardPolicy } from "../services/orchestration/boards.js";
import { parseBoardKeyParam } from "./boards-schemas.js";
import { httpErrorHandler } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";

export const boardPolicyRouter = Router({ caseSensitive: true });

/** An integer field in a range, refused with `invalid-<field>`. */
const whole = (field: string, min: number, max: number) =>
  z
    .number(`invalid-${field}`)
    .int(`invalid-${field}`)
    .min(min, `invalid-${field}`)
    .max(max, `invalid-${field}`);

/** A model name: 1 to 100 characters after trimming, refused with `invalid-<field>`. */
const modelName = (field: string) =>
  z
    .string(`invalid-${field}`)
    .trim()
    .min(1, `invalid-${field}`)
    .max(100, `invalid-${field}`);

/** The D-6 board policy fields, all required; the D-3 fixed supervisor values are not settings. */
const policyBodySchema = z
  .strictObject(
    {
      roadmapApproval: z.enum(
        ["ask", "rules", "all"],
        "invalid-roadmapApproval",
      ),
      concurrencyCap: whole("concurrencyCap", 1, 20),
      loopModel: modelName("loopModel").nullable(),
      orchestratorModel: modelName("orchestratorModel"),
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
    {
      error: (issue) =>
        issue.code === "unrecognized_keys" ? "unknown-field" : "invalid-policy",
    },
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
