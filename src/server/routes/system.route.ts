import { Router } from "express";
import { systemMemory } from "../services/orchestration/memory-governor.js";

export const systemRouter = Router();

systemRouter.get("/system/memory", (_req, res) => {
  res.status(200).json(systemMemory());
});
