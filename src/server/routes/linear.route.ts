import { Router } from "express";
import { parseStateMap } from "../../shared/linear-state-map.js";
import {
  getOrchestrationConfig,
  updateLinearStateMap,
} from "../services/infra/config-holder.js";
import {
  getWorkflow,
  invalidateWorkflow,
} from "../services/orchestration/linear-outbound.js";

export const linearRouter = Router();

linearRouter.get("/sources/linear/workflow", async (_req, res) => {
  const outcome = await getWorkflow();
  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }
  res.status(200).json(outcome.workflow);
});

linearRouter.get("/config/linear-state-map", (_req, res) => {
  res.status(200).json({
    stateMap: getOrchestrationConfig()?.sources?.linear?.stateMap ?? {},
  });
});

linearRouter.put("/config/linear-state-map", (req, res) => {
  const result = parseStateMap(
    (req.body as { stateMap?: unknown } | undefined)?.stateMap,
  );
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  updateLinearStateMap(result.map);
  invalidateWorkflow();
  res.status(204).end();
});
