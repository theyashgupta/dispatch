import type {
  SourceCardStatus,
  SourceConnection,
  SourceKeyError,
} from "../../shared/types.js";

export const CONNECTION_ERROR_COPY: Record<SourceKeyError, string> = {
  rejected: "Linear rejected that key. Double-check it and try again.",
  unreachable: "Couldn't reach Linear. Check your connection and try again.",
  superseded:
    "Linear was disconnected while this key was being checked. Paste it again to reconnect.",
  failed:
    "Dispatch couldn't save the key. Check ~/.dispatch/config.json and try again.",
  "sso-required":
    "Linear refused the key for your organization's single sign-on. Check it and try again.",
  "no-credential": "No key is stored. Paste one and press Connect.",
};

export const GITHUB_ERROR_COPY: Record<SourceKeyError, string> = {
  rejected: "GitHub rejected that token. Double-check it and try again.",
  unreachable: "Couldn't reach GitHub. Check your connection and try again.",
  superseded:
    "GitHub was disconnected while this token was being checked. Paste it again to reconnect.",
  failed:
    "Dispatch couldn't save the token. Check the Dispatch Vault and try again.",
  "sso-required":
    "GitHub needs you to authorize this token for your organization's SAML single sign-on.",
  "no-credential":
    "No token found. Paste one, or log in with the GitHub CLI and try again.",
};

export const SENTRY_ERROR_COPY: Record<SourceKeyError, string> = {
  rejected: "Sentry rejected that token. Double-check it and try again.",
  unreachable: "Couldn't reach Sentry. Check your connection and try again.",
  superseded:
    "Sentry was disconnected while this token was being checked. Paste it again to reconnect.",
  failed:
    "Dispatch couldn't save the token. Check the Dispatch Vault and try again.",
  "sso-required":
    "Sentry refused the token for your organization's single sign-on. Check it and try again.",
  "no-credential":
    "No token is stored in the Vault. Paste one and press Connect.",
};

/**
 * Map the server's connection report to the status a connection card shows.
 *
 * @remarks An error report wins over the configured flag, so a failed first read shows the error
 * instead of passing for a source that was never connected.
 */
export function cardStatusFrom(
  connection: SourceConnection | null,
  copy: Record<SourceKeyError, string> = CONNECTION_ERROR_COPY,
): SourceCardStatus {
  if (connection === null) return { kind: "checking" };
  if (connection.connected) {
    return connection.account
      ? { kind: "connected", account: connection.account }
      : { kind: "connected" };
  }
  if (connection.error) {
    return {
      kind: "error",
      message: withSsoUrl(copy[connection.error], connection.ssoUrl),
    };
  }
  return { kind: "disconnected" };
}

/** Append GitHub's SAML authorization URL to an error message when GitHub sent one. */
export function withSsoUrl(message: string, ssoUrl?: string): string {
  return ssoUrl ? `${message} Authorize it at ${ssoUrl}` : message;
}

/**
 * The label of the button that connects with a credential Dispatch already has, or none.
 *
 * @remarks Shown only while the source is switched off and a credential exists, so an enabled card
 * never offers to connect again and a card with nothing to reuse never offers an empty connect.
 */
export function existingCredentialLabel(
  connection: SourceConnection | null,
): string | undefined {
  if (!connection?.configured || connection.enabled) return undefined;
  if (connection.via === "vault") return "Use the Vault token";
  if (connection.via === "gh") return "Use gh login";
  return undefined;
}
