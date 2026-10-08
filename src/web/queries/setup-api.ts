import type { SetupStatus } from "../../shared/types.js";
import { http, httpError } from "@/lib/http";

/**
 * Read setup status: GET /api/setup.
 *
 * @remarks
 * The Linear key never crosses this boundary. Throws on any non-2xx so the caller can render the
 * app with no wizard.
 */
export async function getSetup(): Promise<SetupStatus> {
  const result = await http<SetupStatus>("/api/setup");
  if (!result.ok) {
    throw httpError("getSetup", result);
  }
  return result.data;
}
