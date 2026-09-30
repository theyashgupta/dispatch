import { z } from "zod";
import { VAULT_NAME_RE } from "../services/infra/vault.js";

const MAX_NAME_LEN = 64;
const MAX_PURPOSE_LEN = 200;
const MAX_VALUE_BYTES = 8192;

/** A key name: exact match, no trimming, env-var shaped and at most 64 characters. */
export const nameSchema = z
  .string("invalid-name")
  .refine(
    (raw) =>
      raw.length > 0 && raw.length <= MAX_NAME_LEN && VAULT_NAME_RE.test(raw),
    "invalid-name",
  );

/** A purpose: trimmed, non-empty, single line and at most 200 characters. */
export const purposeSchema = z
  .string("invalid-purpose")
  .transform((raw) => raw.trim())
  .refine(
    (purpose) =>
      purpose !== "" &&
      purpose.length <= MAX_PURPOSE_LEN &&
      !purpose.includes("\n") &&
      !purpose.includes("\r"),
    "invalid-purpose",
  );

/**
 * A value: a missing or empty one is `missing-value`, any other failure is `invalid-value`.
 *
 * @remarks Newlines are refused because `values.env` is rewritten by line, and the cap counts
 * bytes, since a multi-byte value would slip past a character cap.
 */
export const valueSchema = z
  .string("missing-value")
  .refine((raw) => raw !== "", "missing-value")
  .refine(
    (raw) =>
      !raw.includes("\n") &&
      !raw.includes("\r") &&
      Buffer.byteLength(raw, "utf8") <= MAX_VALUE_BYTES,
    "invalid-value",
  );

/** The `POST /vault` body's name alone, so the later 400s can carry it. */
export const nameBodySchema = z.object({ name: nameSchema }, "invalid-name");

/** The `POST /vault` body; the name is checked first, then the purpose, then an optional value. */
export const createBodySchema = z.object(
  { name: nameSchema, purpose: purposeSchema, value: valueSchema.optional() },
  "invalid-name",
);

export const setValueBodySchema = z.object(
  { value: valueSchema },
  "missing-value",
);

export const editPurposeBodySchema = z.object(
  { purpose: purposeSchema },
  "invalid-purpose",
);
