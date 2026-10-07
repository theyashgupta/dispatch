import { http, httpError } from "@/lib/http";

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
