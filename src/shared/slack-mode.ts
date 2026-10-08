import type { SlackMode } from "./types.js";

/**
 * Pick the Slack mode: the configured one, else `token` when a Vault token exists, else `mcp`.
 *
 * @remarks Any value other than "mcp" or "token" counts as absent, because config.json is hand edited.
 */
export function resolveSlackMode(
  configured: unknown,
  hasVaultToken: boolean,
): SlackMode {
  if (configured === "mcp" || configured === "token") return configured;
  return hasVaultToken ? "token" : "mcp";
}
