import { Router } from "express";
import { httpErrorHandler } from "./error-handler.js";
import { z } from "zod";
import { parseOrThrow } from "./parse-input.js";
import { fromResult } from "./schema-primitives.js";
import { parseStateMap } from "../../shared/linear-state-map.js";
import {
  getOrchestrationConfig,
  updateLinearStateMap,
} from "../services/infra/config-holder.js";
import {
  getWorkflow,
  invalidateWorkflow,
} from "../services/orchestration/linear-outbound.js";
import { HttpError } from "../services/domain/errors.js";

export const linearRouter = Router();

/** Run the shared `parseStateMap` as a schema so its messages stay the client error codes. */
const stateMapSchema = fromResult((input) => {
  const result = parseStateMap(input);
  return result.ok ? { ok: true, value: result.map } : result;
});

const putStateMapSchema = z.object(
  { stateMap: stateMapSchema },
  "stateMap must be an object",
);

linearRouter.get("/sources/linear/workflow", async (_req, res) => {
  const outcome = await getWorkflow();
  if (!outcome.ok) throw new HttpError(outcome.status, outcome.error);
  res.status(200).json(outcome.workflow);
});

linearRouter.get("/config/linear-state-map", (_req, res) => {
  res.status(200).json({
    stateMap: getOrchestrationConfig()?.sources?.linear?.stateMap ?? {},
  });
});

linearRouter.put("/config/linear-state-map", (req, res) => {
  const { stateMap } = parseOrThrow(putStateMapSchema, req.body);
  updateLinearStateMap(stateMap);
  invalidateWorkflow();
  res.status(204).end();
});

linearRouter.use(httpErrorHandler);
