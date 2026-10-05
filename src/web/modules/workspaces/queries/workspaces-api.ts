import type { WorkspacesInventory } from "../../../../shared/types.js";
import { http, httpError } from "@/lib/http";

const WORKSPACES_TIMEOUT_MS = 60_000;

/** Read the Workspaces inventory; `fresh` drops the server's inventory caches first. */
export async function getWorkspaces(
  fresh: boolean,
): Promise<WorkspacesInventory> {
  const result = await http<WorkspacesInventory>(
    fresh ? "/api/workspaces?fresh=1" : "/api/workspaces",
    { signal: AbortSignal.timeout(WORKSPACES_TIMEOUT_MS) },
  );
  if (!result.ok) {
    throw httpError("getWorkspaces", result);
  }
  return result.data;
}

/**
 * Open a card's workspace in an editor: POST /api/cards/:id/open-editor { editor }.
 *
 * @remarks
 * Sends only the `editor` discriminant, because the server reads the path from the card. Answers
 * 204 and throws on any non-2xx.
 */
export async function openWorkspaceEditor(
  cardId: string,
  editor: "code" | "cursor",
): Promise<void> {
  const result = await http(
    `/api/cards/${encodeURIComponent(cardId)}/open-editor`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editor }),
    },
  );
  if (!result.ok) {
    throw httpError("openWorkspaceEditor", result);
  }
}
