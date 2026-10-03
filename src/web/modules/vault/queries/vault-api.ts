import type { VaultKeySummary } from "../../../../shared/types.js";
import { http, httpError } from "@/lib/http";

export type VaultMutationResult = { ok: true } | { ok: false; error: string };

/**
 * List every vault key plus env-vault import detectability: GET /api/vault.
 *
 * @remarks
 * Throws on any non-2xx. Never carries a value, since `VaultKeySummary` has none.
 */
export async function getVaultKeys(): Promise<{
  keys: VaultKeySummary[];
  envVaultAvailable: boolean;
}> {
  const result = await http<{
    keys: VaultKeySummary[];
    envVaultAvailable: boolean;
  }>("/api/vault");
  if (!result.ok) {
    throw httpError("getVaultKeys", result);
  }
  return result.data;
}

/**
 * Import keys from the standalone `~/.claude/env-vault`: POST /api/vault/import, no body.
 *
 * @remarks
 * Skips any name already present in Dispatch's store. Returns names and counts only, since
 * `ImportResult` has no value field.
 */
export async function importFromEnvVault(): Promise<
  | { ok: true; imported: string[]; skipped: string[] }
  | { ok: false; error: string }
> {
  const result = await http<{
    imported: string[];
    skipped: string[];
  }>("/api/vault/import", { method: "POST" });
  if (result.ok) {
    return {
      ok: true,
      imported: result.data.imported,
      skipped: result.data.skipped,
    };
  }
  return { ok: false, error: result.error ?? "generic" };
}

/**
 * Send a JSON body and map the response to a vault mutation result.
 */
async function send(
  url: string,
  method: "POST" | "PUT" | "PATCH",
  body: unknown,
): Promise<VaultMutationResult> {
  const result = await http(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (result.ok) {
    return { ok: true };
  }
  return { ok: false, error: result.error ?? "generic" };
}

/**
 * Create a vault key: POST /api/vault.
 *
 * @remarks
 * The body carries only `name` and `purpose`, never `value`, because creation never takes a value.
 * The server's error string (`invalid-name`, `name-exists`, `invalid-purpose`, `vault-write-
 * failed`) passes through verbatim so the add form's copy table can key off it.
 */
export async function addVaultKey(input: {
  name: string;
  purpose: string;
}): Promise<VaultMutationResult> {
  return send("/api/vault", "POST", input);
}

/**
 * Set or rotate a key's value: PUT /api/vault/:name/value.
 *
 * @remarks
 * Set and rotate share one endpoint. The value goes only into `JSON.stringify({ value })`, never
 * the URL, which is built from `name` alone (`T-104-01`).
 *
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export async function setVaultValue(
  name: string,
  value: string,
): Promise<VaultMutationResult> {
  return send(`/api/vault/${encodeURIComponent(name)}/value`, "PUT", {
    value,
  });
}

type VaultValueRead =
  { ok: true; value: string } | { ok: false; error: string };

async function readVaultValue(
  name: string,
  which: "value" | "previous",
): Promise<VaultValueRead> {
  const result = await http<{ value: string }>(
    `/api/vault/${encodeURIComponent(name)}/${which}`,
  );
  if (result.ok) {
    return { ok: true, value: result.data.value };
  }
  return { ok: false, error: result.error ?? "generic" };
}

/**
 * Read a key's current value: GET /api/vault/:name/value.
 *
 * @remarks
 * Called only when the rotate editor opens for a filled key, never on list load.
 */
export const getVaultValue = (name: string) => readVaultValue(name, "value");

/**
 * Read the value a key held before its latest rotate: GET /api/vault/:name/previous.
 *
 * @remarks
 * Called only on an explicit reveal click, never on list load.
 */
export const getVaultPrevious = (name: string) =>
  readVaultValue(name, "previous");

/**
 * Edit a key's purpose: PATCH /api/vault/:name.
 */
export async function editVaultPurpose(
  name: string,
  purpose: string,
): Promise<VaultMutationResult> {
  return send(`/api/vault/${encodeURIComponent(name)}`, "PATCH", { purpose });
}

/**
 * Delete a vault key: DELETE /api/vault/:name.
 *
 * @remarks
 * Resolves a bare `{ ok }`, because the delete confirm has one shared failure notice.
 */
export async function deleteVaultKey(name: string): Promise<{ ok: boolean }> {
  const result = await http(`/api/vault/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  return { ok: result.ok };
}
