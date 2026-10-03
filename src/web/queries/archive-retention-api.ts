import { http, httpError } from "@/lib/http";

/**
 * Read the archive retention window: GET /api/config/archive-retention.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function getArchiveRetention(): Promise<{
  archiveRetentionDays: number;
}> {
  const result = await http<{ archiveRetentionDays: number }>(
    "/api/config/archive-retention",
  );
  if (!result.ok) {
    throw httpError("getArchiveRetention", result);
  }
  return result.data;
}

/** Persist the archive retention window: PUT /api/config/archive-retention, `saveCleanupDelay`'s shape. */
export async function saveArchiveRetention(
  days: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await http("/api/config/archive-retention", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archiveRetentionDays: days }),
  });
  if (result.ok) return { ok: true };
  if (result.status === 400) {
    return {
      ok: false,
      error: result.error ?? "Couldn't save archive retention.",
    };
  }
  throw httpError("saveArchiveRetention", result);
}
