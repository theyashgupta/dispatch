import { Router } from "express";
import { getWorkflow } from "../services/orchestration/linear-outbound.js";

export const linearRouter = Router();

linearRouter.get("/sources/linear/workflow", async (_req, res) => {
  const outcome = await getWorkflow();
  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }
  res.status(200).json(outcome.workflow);
});
