import type { SourceConnection, SourceKeyError } from "../../shared/types.js";
import { isProviderCode } from "../../shared/credential.js";
import { http, type ApiResult } from "@/lib/http";

/**
 * Read a source's connection status: GET /api/sources/:source/connection.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function getSourceConnection(
  source: string,
): Promise<SourceConnection> {
  const result = await http<SourceConnection>(
    `/api/sources/${encodeURIComponent(source)}/connection`,
  );
  if (!result.ok) {
    throw new Error(`getSourceConnection failed: ${result.status}`);
  }
  return result.data;
}

const SOURCE_KEY_ERRORS = new Set<string>([
  "rejected",
  "unreachable",
  "sso-required",
  "superseded",
  "no-credential",
]);

/**
 * Read the error kind a failed key save or connect answered, plus the provider's own error code.
 *
 * @remarks
 * The server names the kind in the body; the status fallback covers a body that is not
 * JSON, such as a proxy error page. Only a plain lowercase provider code is kept.
 */
function sourceKeyFailure(result: Extract<ApiResult<unknown>, { ok: false }>): {
  ok: false;
  reason: SourceKeyError;
  providerError?: string;
} {
  const body = (result.body ?? {}) as {
    error?: unknown;
    providerError?: unknown;
  };
  const reason: SourceKeyError =
    typeof body.error === "string" && SOURCE_KEY_ERRORS.has(body.error)
      ? (body.error as SourceKeyError)
      : result.status === 400
        ? "rejected"
        : result.status === 502
          ? "unreachable"
          : result.status === 409
            ? "superseded"
            : "failed";
  return isProviderCode(body.providerError)
    ? { ok: false, reason, providerError: body.providerError }
    : { ok: false, reason };
}

/**
 * Store a new key for a source: PUT /api/sources/:source/key.
 *
 * @remarks
 * The server checks the key with the provider before saving it, so a 400 (rejected) and a
 * 502 (unreachable) both mean nothing was written; a 409 means a disconnect won the race. The key
 * is sent once and never echoed back.
 */
export async function saveSourceKey(
  source: string,
  apiKey: string,
): Promise<
  | { ok: true; account?: string }
  | { ok: false; reason: SourceKeyError; providerError?: string }
> {
  const result = await http<{ account?: string }>(
    `/api/sources/${encodeURIComponent(source)}/key`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    },
  );
  if (result.ok) {
    return { ok: true, ...result.data };
  }
  return sourceKeyFailure(result);
}

/**
 * Turn a token source on with the credential it already has: POST /api/sources/:source/connect.
 *
 * @remarks
 * Used when the Vault already holds the token or the gh CLI is logged in, so nothing is
 * pasted and no secret crosses the wire.
 */
export async function connectSource(
  source: string,
): Promise<
  | { ok: true; account?: string }
  | { ok: false; reason: SourceKeyError; providerError?: string }
> {
  const result = await http<{ account?: string }>(
    `/api/sources/${encodeURIComponent(source)}/connect`,
    { method: "POST" },
  );
  if (result.ok) {
    return { ok: true, ...result.data };
  }
  return sourceKeyFailure(result);
}

/**
 * Pause a token source and keep its token: POST /api/sources/:source/disable.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function disableSource(source: string): Promise<void> {
  const result = await http(
    `/api/sources/${encodeURIComponent(source)}/disable`,
    { method: "POST" },
  );
  if (!result.ok) {
    throw new Error(`disableSource failed: ${result.status}`);
  }
}

/**
 * Remove a source's stored key: DELETE /api/sources/:source/key.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function deleteSourceKey(source: string): Promise<void> {
  const result = await http(`/api/sources/${encodeURIComponent(source)}/key`, {
    method: "DELETE",
  });
  if (!result.ok) {
    throw new Error(`deleteSourceKey failed: ${result.status}`);
  }
}
