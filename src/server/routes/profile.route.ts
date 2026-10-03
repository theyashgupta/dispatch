import { Router } from "express";
import { httpErrorHandler } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";
import { fromResult } from "./schema-primitives.js";
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

/** Run the shared `parseProfile` as a schema so its messages stay the client error codes. */
const profileSchema = fromResult(parseProfile);

profileRouter.get("/config/profile", (_req, res) => {
  res.status(200).json(getOrchestrationConfig()?.profile ?? {});
});

profileRouter.put("/config/profile", (req, res) => {
  const profile = parseOrThrow(profileSchema, req.body);
  updateProfile(profile);
  res.status(200).json(profile);
});

profileRouter.use(httpErrorHandler);
