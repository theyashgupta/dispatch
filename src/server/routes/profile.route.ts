import { Router } from "express";
import {
  getOrchestrationConfig,
  updateProfile,
} from "../services/infra/config-holder.js";
import { parseProfile } from "../../shared/profile.js";

/**
 * About you profile surface: read and save the user's profile in `~/.dispatch/config.json`.
 *
 * @remarks The profile lives only in config and on these two routes; it is never copied onto the
 * board snapshot or any SSE frame.
 */
export const profileRouter = Router();

profileRouter.get("/config/profile", (_req, res) => {
  res.status(200).json(getOrchestrationConfig()?.profile ?? {});
});

profileRouter.put("/config/profile", (req, res) => {
  const result = parseProfile(req.body);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  updateProfile(result.value);
  res.status(200).json(result.value);
});
