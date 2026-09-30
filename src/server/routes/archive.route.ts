import { Router } from "express";
import {
  boardRepository as store,
  redactArchivedGroup,
} from "../store/board-repository.js";
import { deleteArchivedGroup } from "../services/orchestration/archive-delete.js";
import {
  ConflictError,
  HttpError,
  NotFoundError,
} from "../services/domain/errors.js";
import { httpErrorHandler } from "./error-handler.js";
import { forceBodySchema } from "./schema-primitives.js";

/**
 * The archive surface (LOCAL-17): list, restore and hard-delete unwound groups.
 * @remarks Every response passes through {@link redactArchivedGroup}, so no card snapshot or
 * session record rides the wire; delete targets come from the stored row, never the request body.
 * @see docs/ARCHITECTURE.md#unwind-and-archive
 */
export const archiveRouter = Router();

archiveRouter.get("/archive", (_req, res) => {
  res
    .status(200)
    .json({ archived: store.listArchive().map(redactArchivedGroup) });
});

archiveRouter.post("/archive/:id/restore", async (req, res) => {
  const result = await store.restoreGroup(req.params.id);
  if (!result.ok) throw new HttpError(result.status, result.reason);
  res.status(200).json({ restored: result.card.id });
});

archiveRouter.delete("/archive/:id", async (req, res) => {
  const { force } = forceBodySchema.parse(req.body);
  const outcome = await deleteArchivedGroup(req.params.id, force);
  if (outcome === "missing") throw new NotFoundError("unknown archive id");
  if (outcome === "deleted") {
    res.status(200).json({ deleted: req.params.id });
    return;
  }
  if (outcome === "restored" || outcome === "busy") {
    throw new ConflictError(
      outcome === "restored"
        ? "this group is back on the board"
        : "a delete is already in flight for this group",
      { blocked: false },
    );
  }
  const row = store.getArchived(req.params.id);
  throw new ConflictError(row?.deleteBlocked ?? "delete refused", {
    blocked: outcome === "blocked",
  });
});

archiveRouter.use(httpErrorHandler);
