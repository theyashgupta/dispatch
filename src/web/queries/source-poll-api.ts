import { http, type ApiResult } from "@/lib/http";

/**
 * Ask the server to poll one source now: POST /api/sources/:id/poll.
 *
 * @remarks
 * Throws on any non-2xx so Sync now can report a refused source; the poll result arrives over SSE
 * like any scheduled poll. The message is the server's own reason or "server unreachable".
 */
export async function pollSource(id: string): Promise<void> {
  let result: ApiResult<unknown>;
  try {
    result = await http(`/api/sources/${encodeURIComponent(id)}/poll`, {
      method: "POST",
    });
  } catch {
    throw new Error("server unreachable");
  }
  if (!result.ok) {
    throw new Error(result.error ?? `poll failed (${result.status})`);
  }
}
