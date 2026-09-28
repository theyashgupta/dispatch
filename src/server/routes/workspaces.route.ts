import { Router } from "express";
import { buildInventory } from "../services/orchestration/workspace-inventory.js";

export const workspacesRouter = Router();

workspacesRouter.get("/workspaces", (req, res) => {
  const fresh = req.query.fresh;
  if (fresh !== undefined && fresh !== "1") {
    res.status(400).json({ error: "fresh must be 1" });
    return;
  }
  buildInventory({ fresh: fresh === "1" })
    .then((inventory) => res.status(200).json(inventory))
    .catch((err: unknown) => {
      console.error("[workspaces] inventory failed:", err);
      res.status(500).json({ error: "inventory failed" });
    });
});
