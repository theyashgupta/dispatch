const SENTRY_ERROR_COPY: Record<string, string> = {
  rejected: "Sentry rejected the token. Reconnect Sentry in Settings.",
  forbidden:
    "Sentry refused this action. Check that the token has the event:write scope.",
  "no-credential": "Sentry is not connected. Connect it in Settings.",
  "not-found": "Sentry could not find this issue.",
  "unknown item": "This error is no longer listed.",
  "rate-limited": "Sentry's rate limit was reached. Try again in a minute.",
  unreachable: "Couldn't reach Sentry. Check your connection and try again.",
};

/** Turn a Sentry failure code into the sentence the page shows; an unknown code reads as unreachable. */
export function sentryFailureText(error: string): string {
  return Object.hasOwn(SENTRY_ERROR_COPY, error)
    ? SENTRY_ERROR_COPY[error]
    : SENTRY_ERROR_COPY.unreachable;
}
