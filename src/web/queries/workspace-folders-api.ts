import type { DirListing, DiscoveredRepo } from "../../shared/types.js";
import { http, httpError } from "@/lib/http";

/**
 * List the registered workspace folders: GET /api/workspace-folders.
 *
 * @remarks
 * Read on modal open for the authoritative registry and the last-used folder to preselect. Throws
 * on any non-2xx so the caller can surface a load failure.
 */
export async function getWorkspaceFolders(): Promise<{
  folders: string[];
  lastUsed: string | null;
}> {
  const result = await http<{ folders: string[]; lastUsed: string | null }>(
    "/api/workspace-folders",
  );
  if (!result.ok) {
    throw httpError("getWorkspaceFolders", result);
  }
  return result.data;
}

/**
 * Register and discover a workspace folder: POST /api/workspace-folders { path }.
 *
 * @remarks
 * The server owns all path normalization, validation and discovery, so the client only forwards
 * the typed path. A 200 resolves `{ ok: true, repos }`, a 400 resolves `{ ok: false, error }` from
 * the parsed body for the modal to show verbatim, and anything else throws.
 */
export async function addWorkspaceFolder(
  path: string,
): Promise<
  { ok: true; repos: DiscoveredRepo[] } | { ok: false; error: string }
> {
  const result = await http<{ repos: DiscoveredRepo[] }>(
    "/api/workspace-folders",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    },
  );
  if (result.ok) {
    return { ok: true, repos: result.data.repos };
  }
  if (result.status === 400) {
    return { ok: false, error: result.error ?? "Couldn't add folder." };
  }
  throw httpError("addWorkspaceFolder", result);
}

/**
 * List the child directories of a folder for the folder-browser picker: GET /api/fs/dirs?path=.
 *
 * @remarks
 * `path` is optional and the server defaults it to `~`, so the query string is built
 * conditionally. Throws on any non-2xx.
 */
export async function browseDirectory(path?: string): Promise<DirListing> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  const result = await http<DirListing>(`/api/fs/dirs${query}`);
  if (!result.ok) {
    throw httpError("browseDirectory", result);
  }
  return result.data;
}

/**
 * Drop a folder from the registry: DELETE /api/workspace-folders { path }.
 *
 * @remarks
 * The endpoint is idempotent, so a double remove is harmless. Throws on any non-2xx so the caller
 * can log, and the SSE snapshot reconciles.
 */
export async function removeWorkspaceFolder(path: string): Promise<void> {
  const result = await http("/api/workspace-folders", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!result.ok) {
    throw httpError("removeWorkspaceFolder", result);
  }
}

/**
 * Re-discover the repos of a registered folder: GET /api/workspace-folders/discover?path=.
 *
 * @remarks
 * A registered folder whose directory was deleted returns `{ repos: [] }` with a 200. Any non-2xx throws.
 */
export async function discoverWorkspaceFolder(
  path: string,
): Promise<{ repos: DiscoveredRepo[] }> {
  const result = await http<{ repos: DiscoveredRepo[] }>(
    `/api/workspace-folders/discover?path=${encodeURIComponent(path)}`,
  );
  if (!result.ok) {
    throw httpError("discoverWorkspaceFolder", result);
  }
  return result.data;
}
