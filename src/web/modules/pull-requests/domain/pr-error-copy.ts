import { withSsoUrl } from "../../../../shared/connection-status.js";

const PR_ERROR_COPY: Record<string, string> = {
  rejected: "GitHub rejected the token. Reconnect GitHub in Settings.",
  "no-credential": "GitHub is not connected. Connect it in Settings.",
  "not-found": "GitHub could not find this pull request.",
  "sso-required":
    "GitHub needs you to authorize the token for this organization's SAML single sign-on.",
  "rate-limited": "GitHub's rate limit was reached. Try again in a minute.",
  unreachable: "Couldn't reach GitHub. Check your connection and try again.",
  "not-mergeable": "GitHub will not merge this pull request.",
  refused: "GitHub refused the review.",
  "invalid review": "Write a comment before sending.",
};

/**
 * Turn a pull request failure into the sentence the page shows.
 *
 * @remarks
 * An unknown code, including an inherited key like "constructor", reads as unreachable. A single
 * sign-on link replaces the GitHub message; otherwise the GitHub message is appended to the code's
 * sentence.
 */
export function prFailureText(
  error: string,
  message?: string,
  ssoUrl?: string,
): string {
  const base = Object.hasOwn(PR_ERROR_COPY, error)
    ? PR_ERROR_COPY[error]
    : PR_ERROR_COPY.unreachable;
  if (ssoUrl) return withSsoUrl(base, ssoUrl);
  return message ? `${base} GitHub said: ${message}` : base;
}
