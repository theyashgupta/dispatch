import type { ArchivedGroupSummary } from "../../../../shared/types.js";
import { http, httpError } from "@/lib/http";

/**
 * Fetch every archived group, newest first: GET /api/archive.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function listArchive(): Promise<ArchivedGroupSummary[]> {
  const result = await http<{ archived: ArchivedGroupSummary[] }>(
    "/api/archive",
  );
  if (!result.ok) {
    throw httpError("listArchive", result);
  }
  return result.data.archived;
}

/**
 * Restore an archived group all-or-nothing: POST /api/archive/:id/restore.
 *
 * @remarks
 * A 404 or 409 answers the server's reason, naming the member that moved on, and any other failure
 * throws.
 */
export async function restoreArchived(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await http(`/api/archive/${encodeURIComponent(id)}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (result.ok) return { ok: true };
  if (result.status === 404 || result.status === 409) {
    return { ok: false, error: result.error ?? "Couldn't restore this group." };
  }
  throw httpError("restoreArchived", result);
}

/**
 * Hard-delete an archived group's worktrees: DELETE /api/archive/:id.
 *
 * @remarks
 * `force` overrides the dirty-worktree preflight that otherwise answers a 409 with the reason the
 * server recorded on the row.
 */
export async function deleteArchived(
  id: string,
  force: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await http(`/api/archive/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  });
  if (result.ok) return { ok: true };
  if (result.status === 404 || result.status === 409) {
    return { ok: false, error: result.error ?? "Couldn't delete this group." };
  }
  throw httpError("deleteArchived", result);
}
