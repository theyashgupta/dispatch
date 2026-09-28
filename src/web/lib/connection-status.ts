import type {
  CalendarErrorCode,
  CalendarStatus,
  GranolaCheckState,
  GranolaError,
  GranolaStatus,
  SourceCardStatus,
  SourceConnection,
  SourceKeyError,
} from "../../shared/types.js";
import { isProviderCode } from "../../shared/credential.js";
import { formatAge } from "./format-age.js";

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

export const SLACK_ERROR_COPY: Record<SourceKeyError, string> = {
  rejected:
    "Slack rejected that token. Paste a user token (xoxp-) or a bot token (xoxb-).",
  unreachable: "Couldn't reach Slack. Check your connection and try again.",
  superseded:
    "Slack was disconnected while this token was being checked. Paste it again to reconnect.",
  failed:
    "Dispatch couldn't save the token. Check the Dispatch Vault and try again.",
  "sso-required":
    "Slack refused the token for your organization's single sign-on. Check it and try again.",
  "no-credential": "No token found. Paste one and press Connect.",
};

export const SLACK_BOT_NOTE =
  "Bot token: Dispatch sees only mentions of the bot and channels it was invited to. A user token sees your own DMs and mentions.";

/** The line that quotes Slack's own error code, or none when Slack sent no plain code. */
export function slackSaidLine(code: string | null | undefined): string | null {
  return isProviderCode(code) ? `Slack said: ${code}.` : null;
}

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

export const GRANOLA_LOAD_FAILED_COPY =
  "Couldn't load the Granola status. Reload the page.";

export const GRANOLA_ERROR_COPY: Record<GranolaError, string> = {
  "claude-missing": "Claude Code is not installed or not on PATH.",
  "not-found":
    "Granola is not connected in Claude Code. Add the Granola connector, then press Check connection.",
  "needs-auth":
    "The Granola connector needs you to sign in. Open Claude Code and authenticate it.",
  failed: "Claude couldn't use the Granola connector. Try again later.",
  timeout: "The round took longer than 5 minutes and was stopped.",
  unreadable: "Claude returned no readable action items.",
};

/**
 * Map the Granola round status to the status its connection card shows.
 *
 * @remarks A failed Check connection outranks the last round, so the chip never reads Connected
 * beside a check that just said otherwise.
 */
export function granolaCardStatus(
  status: GranolaStatus | null,
  check: { state: GranolaCheckState } | null = null,
  loadFailed = false,
): SourceCardStatus {
  if (status === null) {
    return loadFailed
      ? { kind: "error", message: GRANOLA_LOAD_FAILED_COPY }
      : { kind: "checking" };
  }
  if (!status.enabled) return { kind: "off" };
  if (check !== null && check.state !== "connected") {
    return { kind: "error", message: GRANOLA_ERROR_COPY[check.state] };
  }
  if (status.lastError !== undefined) {
    return { kind: "error", message: GRANOLA_ERROR_COPY[status.lastError] };
  }
  return status.server !== undefined
    ? { kind: "connected", account: status.server }
    : { kind: "connected" };
}

/**
 * The status line under the Granola controls: running, the last run, or not run yet.
 */
export function granolaRunLine(status: GranolaStatus, now: number): string {
  if (status.running) return "Analyzing meetings";
  if (status.lastRunAt === undefined) return "Not run yet";
  const count = status.lastCount;
  const age = formatAge(status.lastRunAt, now);
  if (count === undefined) return `Last run ${age}`;
  return `Last run ${age}, ${count === 1 ? "1 action item" : `${count} action items`}`;
}

export const CALENDAR_ERROR_COPY: Record<CalendarErrorCode, string> = {
  "calendar-denied":
    "Dispatch needs access to your calendars. Open System Settings, Privacy and Security, Calendars, and allow the app that runs Dispatch.",
  "ical-url-missing": "Fill CALENDAR_ICAL_URL in Settings, Vault first.",
  "ical-url-invalid": "The iCal URL in the Vault is not a valid https address.",
  "ical-unreachable":
    "Couldn't fetch the iCal URL. Check the address in the Vault.",
  "ical-invalid": "The iCal URL did not return a calendar.",
  "ical-too-large": "The calendar is larger than 5 MB.",
  timeout: "Reading the calendar took longer than 30 seconds.",
  failed: "Couldn't read the calendar.",
};

export const CALENDAR_LOAD_FAILED_COPY =
  "Couldn't load the Calendar status. Reload the page.";

/**
 * Map the Calendar status to the status its connection card shows (U4-10).
 *
 * @remarks A refused Connect or Load outranks the saved state, so the card shows why the click
 * failed instead of a stale Not connected.
 */
export function calendarCardStatus(
  status: CalendarStatus | null,
  actionError: CalendarErrorCode | null = null,
  loadFailed = false,
): SourceCardStatus {
  if (status === null) {
    return loadFailed
      ? { kind: "error", message: CALENDAR_LOAD_FAILED_COPY }
      : { kind: "checking" };
  }
  if (actionError !== null) {
    return { kind: "error", message: CALENDAR_ERROR_COPY[actionError] };
  }
  if (!status.enabled) return { kind: "disconnected" };
  if (status.lastError !== undefined) {
    return { kind: "error", message: CALENDAR_ERROR_COPY[status.lastError] };
  }
  const account =
    status.mode === "ical"
      ? "iCal URL"
      : status.calendars.length === 0
        ? "All calendars"
        : `${status.calendars.length} calendars`;
  return { kind: "connected", account };
}
