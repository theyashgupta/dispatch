import type { UpdateRunResult, UpdateStatus } from "../../shared/types.js";
import { http, httpError } from "@/lib/http";

/**
 * Read the cached update status: GET /api/update.
 *
 * @remarks
 * The server serves its 24h-cached registry check, never a fresh network hit per page load. Throws
 * on any non-2xx so the banner stays hidden on failure.
 */
export async function getUpdateStatus(): Promise<UpdateStatus> {
  const result = await http<UpdateStatus>("/api/update");
  if (!result.ok) {
    throw httpError("getUpdateStatus", result);
  }
  return result.data;
}

/**
 * Run the loopback update: POST /api/update/run.
 *
 * @remarks
 * Sends no body, because install mode and the target package are entirely server-resolved. Throws
 * only on a genuine non-2xx, since a 200 body with `ok` true or false is an application state the
 * banner renders.
 */
export async function runUpdate(): Promise<UpdateRunResult> {
  const result = await http<UpdateRunResult>("/api/update/run", {
    method: "POST",
  });
  if (!result.ok) {
    throw httpError("runUpdate", result);
  }
  return result.data;
}
