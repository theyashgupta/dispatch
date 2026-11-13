import type { UsageThresholds } from "../../shared/usage-thresholds.js";
import { http, httpError } from "@/lib/http";

/**
 * Read the usage thresholds: GET /api/config/usage-thresholds.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function getUsageThresholds(): Promise<UsageThresholds> {
  const result = await http<UsageThresholds>("/api/config/usage-thresholds");
  if (!result.ok) {
    throw httpError("getUsageThresholds", result);
  }
  return result.data;
}

/** Persist the usage thresholds: PUT /api/config/usage-thresholds, `saveCleanupDelay`'s shape. */
export async function saveUsageThresholds(
  thresholds: UsageThresholds,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await http("/api/config/usage-thresholds", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(thresholds),
  });
  if (result.ok) return { ok: true };
  if (result.status === 400) {
    return {
      ok: false,
      error: result.error ?? "Couldn't save the usage thresholds.",
    };
  }
  throw httpError("saveUsageThresholds", result);
}
