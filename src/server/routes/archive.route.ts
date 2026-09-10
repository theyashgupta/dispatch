import { Router } from "express";
import { store, redactArchivedGroup } from "../store/board.store.js";
import { deleteArchivedGroup } from "../services/orchestration/archive-delete.js";

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
  if (!result.ok) {
    res.status(result.status).json({ error: result.reason });
    return;
  }
  res.status(200).json({ restored: result.card.id });
});

archiveRouter.delete("/archive/:id", async (req, res) => {
  const force = (req.body as { force?: unknown } | undefined)?.force === true;
  const outcome = await deleteArchivedGroup(req.params.id, force);
  if (outcome === "missing") {
    res.status(404).json({ error: "unknown archive id" });
    return;
  }
  if (outcome === "deleted") {
    res.status(200).json({ deleted: req.params.id });
    return;
  }
  if (outcome === "restored" || outcome === "busy") {
    res.status(409).json({
      error:
        outcome === "restored"
          ? "this group is back on the board"
          : "a delete is already in flight for this group",
      blocked: false,
    });
    return;
  }
  const row = store.getArchived(req.params.id);
  res.status(409).json({
    error: row?.deleteBlocked ?? "delete refused",
    blocked: outcome === "blocked",
  });
});
