import type { SourceCredential } from "../../../shared/types.js";
import { readGhToken } from "../../adapters/gh.js";
import { readCurrent } from "./vault.js";

export const GITHUB_TOKEN_KEY = "GITHUB_TOKEN";

const TOKEN_SHAPE = /^[\x21-\x7e]+$/;

/**
 * Resolve the GitHub token: the Vault value when it is non-empty, else the gh CLI login.
 *
 * @remarks Read fresh on every call so a Vault edit or a gh re-login applies to the next poll. A
 * token that is not printable ASCII resolves to null, because fetch rejects it with an error that
 * quotes the whole header value.
 */
export async function resolveGithubToken(): Promise<SourceCredential | null> {
  const stored = await readCurrent(GITHUB_TOKEN_KEY).catch(() => null);
  const vaultToken = stored?.ok ? stored.value.trim() : "";
  const credential: SourceCredential | null =
    vaultToken !== ""
      ? { token: vaultToken, via: "vault" }
      : await readGhToken().then((token) =>
          token ? { token, via: "gh" } : null,
        );
  return credential && TOKEN_SHAPE.test(credential.token) ? credential : null;
}
