import fs from "node:fs";
import { Router, type Request, type Response } from "express";
import type { z } from "zod";
import { vaultKeyUsers } from "../adapters/source-gateway.js";
import {
  listKeys,
  createKey,
  setValue,
  editPurpose,
  deleteKey,
  readPrevious,
  readCurrent,
  importFromEnvVault,
} from "../services/infra/vault.js";
import {
  ENV_VAULT_SCHEMA_PATH,
  ENV_VAULT_VALUES_PATH,
} from "../services/infra/paths.js";
import {
  HttpError,
  NotFoundError,
  ValidationError,
} from "../services/domain/errors.js";
import { httpErrorHandler, orFail } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";
import {
  createBodySchema,
  editPurposeBodySchema,
  nameBodySchema,
  nameSchema,
  setValueBodySchema,
} from "./vault-schemas.js";

/**
 * Vault CRUD routes, mounted behind the single app-level gate hoisted in `bootstrap/index.ts`
 * (never a standalone router). A list entry carries only name, purpose, timestamps and the
 * `filled`/`hasPrevious` flags (T-103-01). Exactly two read paths carry a value, each for one
 * named key on explicit request only: `GET /vault/:name/value` (the current value, shown by the
 * rotate flow before it is replaced) and `GET /vault/:name/previous` (the value held before the
 * latest rotate). Every mutating handler re-validates its own body independently of any
 * client-side check (the route is gated by loopback OR a valid remote session, not trust-gated),
 * and a value is accepted from a JSON request body only, never a query string or a path segment.
 * Every unexpected throw maps to a generic 500 with no stack, path or filesystem-error text
 * (T-103-04).
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export const vaultRouter = Router();

/**
 * Parse a body whose 400s carry the key name beside the code.
 *
 * @remarks `invalid-name` never carries it, because there is no valid name to report.
 */
function parseKeyBody<T>(schema: z.ZodType<T>, body: unknown, name: string): T {
  try {
    return parseOrThrow(schema, body);
  } catch (err) {
    if (err instanceof ValidationError && err.code !== "invalid-name") {
      throw new ValidationError(err.code, { name });
    }
    throw err;
  }
}

vaultRouter.get("/vault", async (_req, res) => {
  const body = await orFail("vault-read-failed", async () => {
    const envVaultAvailable =
      fs.existsSync(ENV_VAULT_SCHEMA_PATH) ||
      fs.existsSync(ENV_VAULT_VALUES_PATH);
    const keys = (await listKeys()).map((k) => ({
      ...k,
      usedBy: vaultKeyUsers(k.name),
    }));
    return { keys, envVaultAvailable };
  });
  res.status(200).json(body);
});

vaultRouter.post("/vault/import", async (_req, res) => {
  const { imported, skipped } = await orFail(
    "vault-import-failed",
    importFromEnvVault,
  );
  res.status(200).json({ imported, skipped });
});

vaultRouter.post("/vault", async (req, res) => {
  const { name } = parseOrThrow(nameBodySchema, req.body);
  const { purpose, value } = parseKeyBody(createBodySchema, req.body, name);
  const result = await orFail("vault-write-failed", () =>
    createKey({ name, purpose, value }),
  );
  if (!result.ok) {
    throw new HttpError(
      result.error === "name-exists" ? 409 : 400,
      result.error,
      {
        name,
      },
    );
  }
  res.status(200).json({ key: result.key });
});

vaultRouter.put("/vault/:name/value", async (req, res) => {
  const name = parseOrThrow(nameSchema, req.params.name);
  const { value } = parseKeyBody(setValueBodySchema, req.body, name);
  const result = await orFail("vault-write-failed", () =>
    setValue(name, value),
  );
  if (!result.ok) throw new NotFoundError(result.error, { name });
  res.status(200).json({ key: result.key });
});

/**
 * Handler for the two single-key value reads; `read` is the domain reader for one sealed file.
 */
function readValueRoute(read: typeof readPrevious) {
  return async (req: Request, res: Response) => {
    const name = parseOrThrow(nameSchema, req.params.name);
    const result = await orFail("vault-read-failed", () => read(name));
    if (!result.ok) throw new NotFoundError(result.error, { name });
    res.status(200).json({ value: result.value });
  };
}

vaultRouter.get("/vault/:name/value", readValueRoute(readCurrent));
vaultRouter.get("/vault/:name/previous", readValueRoute(readPrevious));

vaultRouter.patch("/vault/:name", async (req, res) => {
  const name = parseOrThrow(nameSchema, req.params.name);
  const { purpose } = parseKeyBody(editPurposeBodySchema, req.body, name);
  const result = await orFail("vault-write-failed", () =>
    editPurpose(name, purpose),
  );
  if (!result.ok) throw new NotFoundError(result.error, { name });
  res.status(200).json({ key: result.key });
});

vaultRouter.delete("/vault/:name", async (req, res) => {
  const name = parseOrThrow(nameSchema, req.params.name);
  const result = await orFail("vault-write-failed", () => deleteKey(name));
  if (!result.ok) throw new NotFoundError(result.error, { name });
  res.status(200).json({ ok: true });
});

vaultRouter.use(httpErrorHandler);
