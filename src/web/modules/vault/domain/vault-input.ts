import { VAULT_NAME_RE } from "./vault-name.js";

const PURPOSE_MAX = 200;
const VALUE_MAX_BYTES = 8192;

function purposeRefused(purpose: string): boolean {
  return (
    purpose === "" ||
    purpose.length > PURPOSE_MAX ||
    purpose.includes("\n") ||
    purpose.includes("\r")
  );
}

/**
 * Check a new key's trimmed name and purpose before any request.
 *
 * @remarks
 * Returns the error code the add form shows, or null when the request may go.
 */
export function addKeyInputError(
  name: string,
  purpose: string,
): "invalid-name" | "invalid-purpose" | null {
  if (!VAULT_NAME_RE.test(name)) return "invalid-name";
  if (purposeRefused(purpose)) return "invalid-purpose";
  return null;
}

/** Check an edited, trimmed purpose before any request. */
export function purposeInputError(purpose: string): "invalid-purpose" | null {
  return purposeRefused(purpose) ? "invalid-purpose" : null;
}

/**
 * Check a trimmed value before any request.
 *
 * @remarks
 * A value is one line of at most 8192 UTF-8 bytes, the server's limit.
 */
export function valueInputError(
  value: string,
): "missing-value" | "invalid-value" | null {
  if (value === "") return "missing-value";
  if (
    value.includes("\n") ||
    value.includes("\r") ||
    new TextEncoder().encode(value).length > VALUE_MAX_BYTES
  ) {
    return "invalid-value";
  }
  return null;
}
