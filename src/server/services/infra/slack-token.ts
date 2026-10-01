import { TOKEN_SHAPE } from "../../../shared/credential.js";
import type { SourceCredential } from "../../../shared/types.js";
import { readCurrent } from "./vault.js";

export const SLACK_USER_TOKEN_KEY = "SLACK_USER_TOKEN";

export const SLACK_BOT_TOKEN_KEY = "SLACK_BOT_TOKEN";

const SLACK_KEYS = [
  { key: SLACK_USER_TOKEN_KEY, kind: "user" },
  { key: SLACK_BOT_TOKEN_KEY, kind: "bot" },
] as const;

/**
 * Resolve the Slack token: the user token when its Vault value is usable, else the bot token.
 *
 * @remarks Read fresh on every call so a Vault edit applies to the next poll. A value that is not
 * printable ASCII is skipped, because fetch rejects it with an error that quotes the whole header.
 */
export async function resolveSlackToken(): Promise<SourceCredential | null> {
  for (const { key, kind } of SLACK_KEYS) {
    const stored = await readCurrent(key).catch(() => null);
    const token = stored?.ok ? stored.value.trim() : "";
    if (TOKEN_SHAPE.test(token)) return { token, via: "vault", key, kind };
  }
  return null;
}

/** The Vault key a pasted Slack token belongs in, or null for any token that is not xoxp or xoxb. */
export function slackKeyFor(token: string): string | null {
  if (token.startsWith("xoxp-")) return SLACK_USER_TOKEN_KEY;
  if (token.startsWith("xoxb-")) return SLACK_BOT_TOKEN_KEY;
  return null;
}
