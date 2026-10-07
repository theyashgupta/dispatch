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
