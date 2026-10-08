import { Router } from "express";
import { z } from "zod";
import {
  INTAKE_GOAL_MAX,
  INTAKE_REQUIREMENTS_MAX_BYTES,
} from "../../shared/orchestrator-limits.js";
import { resolveBoard } from "../services/orchestration/boards.js";
import { submitIntake } from "../services/orchestration/intake.js";
import { parseBoardKeyParam } from "./boards-schemas.js";
import { httpErrorHandler } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";
import { unknownFieldError } from "./schema-primitives.js";

export const intakeRouter = Router({ caseSensitive: true });

const intakeBodySchema = z.strictObject(
  {
    goal: z
      .string("invalid-goal")
      .trim()
      .min(1, "invalid-goal")
      .max(INTAKE_GOAL_MAX, "invalid-goal"),
    requirements: z
      .string("invalid-requirements")
      .refine(
        (text) => Buffer.byteLength(text) <= INTAKE_REQUIREMENTS_MAX_BYTES,
        "invalid-requirements",
      )
      .optional(),
  },
  { error: unknownFieldError() },
);

intakeRouter.post("/boards/:key/intake", (req, res) => {
  const board = resolveBoard(parseBoardKeyParam(req.params.key));
  const input = parseOrThrow(intakeBodySchema, req.body);
  res.status(202).json({ eventId: submitIntake(board, input) });
});

intakeRouter.use(httpErrorHandler);
