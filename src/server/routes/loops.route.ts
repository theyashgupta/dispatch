import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { resolveHookToken } from "../services/orchestration/hook-tokens.js";
import { reportLoopGate } from "../services/orchestration/loop-report.js";
import { HttpError } from "../services/domain/errors.js";
import { httpErrorHandler, orFail } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";

export const loopsRouter = Router();

/** An integer from 1 to 99, with `code` as the issue. */
const upTo99 = (code: string) =>
  z.number(code).int(code).min(1, code).max(99, code);

/**
 * Body of a loop gate report, strict so a claimed card or session id fails.
 *
 * @remarks A phase report needs `phase`; a unit report may omit it.
 */
const loopReportSchema = z
  .strictObject(
    {
      kind: z.enum(["phase", "unit"], "invalid-kind"),
      unit: upTo99("invalid-unit"),
      phase: upTo99("invalid-phase").optional(),
      result: z.enum(["pass", "fail"], "invalid-result"),
      note: z
        .string("invalid-note")
        .refine((note) => note.length <= 500, "invalid-note")
        .optional(),
    },
    "unknown-field",
  )
  .superRefine((body, ctx) => {
    if (body.kind === "phase" && body.phase === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "phase-required",
        path: ["phase"],
      });
    }
  });

/**
 * Token-gated loop gate report for POST /loops/report: the card and session come only from the token.
 *
 * @remarks The token is checked before the body is parsed, so an unauthenticated caller learns nothing about the schema.
 */
async function handleLoopReport(req: Request, res: Response): Promise<void> {
  const token = req.headers["x-dispatch-token"];
  const entry =
    typeof token === "string" && token.length > 0
      ? resolveHookToken(token)
      : undefined;
  if (!entry) throw new HttpError(401, "invalid hook token");
  const report = parseOrThrow(loopReportSchema, req.body);
  await orFail(
    "loop-report-failed",
    () => reportLoopGate(entry, report),
    "[loops] report failed",
  );
  res.status(202).end();
}

loopsRouter.post("/loops/report", handleLoopReport);

loopsRouter.use(httpErrorHandler);
