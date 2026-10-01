import type { SourceCredential } from "../../../shared/types.js";
import { readCurrent } from "./vault.js";

export const SENTRY_TOKEN_KEY = "SENTRY_TOKEN";

const TOKEN_SHAPE = /^[\x21-\x7e]+$/;

/**
 * Resolve the Sentry token from the Vault, or null when the value is empty or unusable.
 *
 * @remarks Read fresh on every call so a Vault edit applies to the next poll. There is no CLI
 * fallback, and a token that is not printable ASCII resolves to null because fetch rejects it with
 * an error that quotes the whole header value.
 */
export async function resolveSentryToken(): Promise<SourceCredential | null> {
  const stored = await readCurrent(SENTRY_TOKEN_KEY).catch(() => null);
  const token = stored?.ok ? stored.value.trim() : "";
  return token !== "" && TOKEN_SHAPE.test(token)
    ? { token, via: "vault" }
    : null;
}
