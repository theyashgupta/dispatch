import { Router } from "express";
import { httpErrorHandler } from "./error-handler.js";
import { z } from "zod";
import { parseOrThrow } from "./parse-input.js";
import { buildInventory } from "../services/orchestration/workspace-inventory.js";
import { resolveBoard } from "../services/orchestration/boards.js";
import { parseBoardParam } from "./boards-schemas.js";
import { InternalError } from "../services/domain/errors.js";

export const workspacesRouter = Router();

const querySchema = z.object(
  { fresh: z.literal("1", "fresh must be 1").optional() },
  "fresh must be 1",
);

workspacesRouter.get("/workspaces", async (req, res) => {
  const { fresh } = parseOrThrow(querySchema, req.query);
  const { key } = resolveBoard(parseBoardParam(req.query));
  const inventory = await buildInventory({
    fresh: fresh === "1",
    board: key,
  }).catch((err: unknown) => {
    console.error("[workspaces] inventory failed:", err);
    throw new InternalError("inventory failed");
  });
  res.status(200).json(inventory);
});

workspacesRouter.use(httpErrorHandler);
