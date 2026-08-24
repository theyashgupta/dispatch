import { Router } from "express";
import {
  VAULT_NAME_RE,
  listKeys,
  createKey,
  setValue,
  editPurpose,
  deleteKey,
} from "../services/domain/vault.js";

const MAX_NAME_LEN = 64;
const MAX_PURPOSE_LEN = 200;
const MAX_VALUE_BYTES = 8192;

/**
 * Vault CRUD routes, mounted behind the single app-level gate hoisted in `bootstrap/index.ts`
 * (never a standalone router). These routes are write-only for values: no handler, at any path,
 * ever returns a stored value, a list entry carries only name, purpose, timestamps and a `filled`
 * flag. Every mutating handler re-validates its own body independently of any client-side check
 * (the route is gated by loopback OR a valid remote session, not trust-gated), and a value is
 * accepted from a JSON request body only, never a query string or a path segment. Every unexpected
 * throw maps to a generic 500 with no stack, path or filesystem-error text.
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export const vaultRouter = Router();

/** Validate a key name: exact match, no trimming, env-var shaped and within the length cap. */
function validateName(
  raw: unknown,
): { ok: true; name: string } | { ok: false; error: "invalid-name" } {
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    raw.length > MAX_NAME_LEN ||
    !VAULT_NAME_RE.test(raw)
  ) {
    return { ok: false, error: "invalid-name" };
  }
  return { ok: true, name: raw };
}

/** Validate a purpose string: trimmed, non-empty, single line, within the length cap. */
function validatePurpose(
  raw: unknown,
): { ok: true; purpose: string } | { ok: false; error: "invalid-purpose" } {
  if (typeof raw !== "string") {
    return { ok: false, error: "invalid-purpose" };
  }
  const purpose = raw.trim();
  if (
    purpose === "" ||
    purpose.length > MAX_PURPOSE_LEN ||
    purpose.includes("\n") ||
    purpose.includes("\r")
  ) {
    return { ok: false, error: "invalid-purpose" };
  }
  return { ok: true, purpose };
}

/**
 * Validate a value: a missing or empty value is `missing-value`, everything else that fails is
 * `invalid-value`. Rejects `\n`/`\r` since `values.env` is a one-line-per-key file the store
 * rewrites by line, and caps byte length rather than character length since a multi-byte value
 * would otherwise slip past a character-count cap.
 */
function validateValue(
  raw: unknown,
):
  | { ok: true; value: string }
  | { ok: false; error: "missing-value" | "invalid-value" } {
  if (typeof raw !== "string" || raw === "") {
    return { ok: false, error: "missing-value" };
  }
  if (
    raw.includes("\n") ||
    raw.includes("\r") ||
    Buffer.byteLength(raw, "utf8") > MAX_VALUE_BYTES
  ) {
    return { ok: false, error: "invalid-value" };
  }
  return { ok: true, value: raw };
}

vaultRouter.get("/vault", async (_req, res) => {
  res.status(200).json({ keys: await listKeys() });
});

vaultRouter.post("/vault", async (req, res) => {
  const body = req.body as
    { name?: unknown; purpose?: unknown; value?: unknown } | undefined;

  const nameResult = validateName(body?.name);
  if (!nameResult.ok) {
    res.status(400).json({ error: nameResult.error });
    return;
  }
  const { name } = nameResult;

  const purposeResult = validatePurpose(body?.purpose);
  if (!purposeResult.ok) {
    res.status(400).json({ error: purposeResult.error, name });
    return;
  }
  const { purpose } = purposeResult;

  let value: string | undefined;
  if (body?.value !== undefined) {
    const valueResult = validateValue(body.value);
    if (!valueResult.ok) {
      res.status(400).json({ error: valueResult.error, name });
      return;
    }
    value = valueResult.value;
  }

  try {
    const result = await createKey({ name, purpose, value });
    if (!result.ok) {
      const status = result.error === "name-exists" ? 409 : 400;
      res.status(status).json({ error: result.error, name });
      return;
    }
    res.status(200).json({ key: result.key });
  } catch {
    res.status(500).json({ error: "vault-write-failed" });
  }
});

vaultRouter.put("/vault/:name/value", async (req, res) => {
  const nameResult = validateName(req.params.name);
  if (!nameResult.ok) {
    res.status(400).json({ error: nameResult.error });
    return;
  }
  const { name } = nameResult;

  const body = req.body as { value?: unknown } | undefined;
  const valueResult = validateValue(body?.value);
  if (!valueResult.ok) {
    res.status(400).json({ error: valueResult.error, name });
    return;
  }

  try {
    const result = await setValue(name, valueResult.value);
    if (!result.ok) {
      res.status(404).json({ error: result.error, name });
      return;
    }
    res.status(200).json({ key: result.key });
  } catch {
    res.status(500).json({ error: "vault-write-failed" });
  }
});

vaultRouter.patch("/vault/:name", async (req, res) => {
  const nameResult = validateName(req.params.name);
  if (!nameResult.ok) {
    res.status(400).json({ error: nameResult.error });
    return;
  }
  const { name } = nameResult;

  const body = req.body as { purpose?: unknown } | undefined;
  const purposeResult = validatePurpose(body?.purpose);
  if (!purposeResult.ok) {
    res.status(400).json({ error: purposeResult.error, name });
    return;
  }

  try {
    const result = await editPurpose(name, purposeResult.purpose);
    if (!result.ok) {
      res.status(404).json({ error: result.error, name });
      return;
    }
    res.status(200).json({ key: result.key });
  } catch {
    res.status(500).json({ error: "vault-write-failed" });
  }
});

vaultRouter.delete("/vault/:name", async (req, res) => {
  const nameResult = validateName(req.params.name);
  if (!nameResult.ok) {
    res.status(400).json({ error: nameResult.error });
    return;
  }
  const { name } = nameResult;

  try {
    const result = await deleteKey(name);
    if (!result.ok) {
      res.status(404).json({ error: result.error, name });
      return;
    }
    res.status(200).json({ ok: true });
  } catch {
    res.status(500).json({ error: "vault-write-failed" });
  }
});
