import { SLACK_TOKEN_CONSENT_LINE } from "../../../../shared/connection-meta.js";
import {
  SLACK_ERROR_COPY,
  cardStatusFrom,
} from "../../../../shared/connection-status.js";
import { formatAge } from "../../../../shared/format-age.js";
import type {
  SlackConnectorState,
  SlackMcpStatus,
  SlackMode,
  SlackRoundError,
  SourceCardStatus,
  SourceConnection,
} from "../../../../shared/types.js";

export const SLACK_CONNECTOR_LABEL: Record<SlackConnectorState, string> = {
  connected: "connected",
  "needs-auth": "needs auth",
  "not-found": "not found",
  failed: "failed",
  "claude-missing": "Claude Code not found",
};

const CONNECTOR_ONLY_ERRORS: ReadonlySet<SlackRoundError> = new Set([
  "needs-auth",
  "not-found",
  "claude-missing",
]);

export const SLACK_LOAD_FAILED_COPY =
  "Couldn't load the Slack status. Reload the page.";

const SLACK_ROUND_ERROR_COPY: Record<SlackRoundError, string> = {
  "needs-auth": `Slack connector: ${SLACK_CONNECTOR_LABEL["needs-auth"]}. Open claude.ai, Settings, Connectors, and sign in to Slack again.`,
  "not-found": `Slack connector: ${SLACK_CONNECTOR_LABEL["not-found"]}. Connect Slack in claude.ai first, then run claude mcp list.`,
  failed: `Slack connector: ${SLACK_CONNECTOR_LABEL.failed}. Claude could not use the Slack connector. Try again later.`,
  "claude-missing": `Slack connector: ${SLACK_CONNECTOR_LABEL["claude-missing"]}. Install Claude Code and put it on your PATH.`,
  timeout: "The last round took longer than 5 minutes and stopped.",
  "invalid-output":
    "The last round returned output Dispatch could not read. No item was created.",
};

/** The line under the Slack controls that names the connector state, or null before any read. */
export function slackConnectorLine(
  connector: SlackConnectorState | undefined,
): string | null {
  return connector === undefined
    ? null
    : `Slack connector: ${SLACK_CONNECTOR_LABEL[connector]}`;
}

/**
 * Map the Slack mode, the connector status and the connection read to the status the card shows.
 *
 * @remarks
 * In `token` mode the card follows the connection read alone, whatever the connector status says. In `mcp` mode a
 * connector problem outranks the last round error, because no round can run until it is fixed. A
 * round error that only named the connector state is stale once the connector reads connected.
 */
export function slackCardStatus(input: {
  mode: SlackMode;
  mcp: SlackMcpStatus | null;
  mcpLoadFailed: boolean;
  connection: SourceConnection | null;
}): SourceCardStatus {
  const { mode, mcp, mcpLoadFailed, connection } = input;
  if (mode === "token") return cardStatusFrom(connection, SLACK_ERROR_COPY);
  if (mcp === null) {
    return mcpLoadFailed
      ? { kind: "error", message: SLACK_LOAD_FAILED_COPY }
      : { kind: "checking" };
  }
  if (!mcp.enabled) return { kind: "off" };
  if (mcp.connector !== undefined && mcp.connector !== "connected") {
    return { kind: "error", message: SLACK_ROUND_ERROR_COPY[mcp.connector] };
  }
  if (
    mcp.lastError !== undefined &&
    !CONNECTOR_ONLY_ERRORS.has(mcp.lastError)
  ) {
    return { kind: "error", message: SLACK_ROUND_ERROR_COPY[mcp.lastError] };
  }
  return mcp.server !== undefined
    ? { kind: "connected", account: mcp.server }
    : { kind: "connected" };
}

/** The line under the Run now button: reading, never run, or the last round time and new items. */
export function slackRunLine(status: SlackMcpStatus, now: number): string {
  if (status.running) return "Reading Slack";
  if (status.lastRunAt === undefined) return "Not run yet";
  const age = formatAge(status.lastRunAt, now);
  const count = status.lastCount;
  if (count === undefined) return `Last round ${age}`;
  return `Last round ${age}, ${count === 1 ? "1 new item" : `${count} new items`}`;
}

/** True only in `token` mode, so the token fields never show for the connector. */
export function showsTokenFields(mode: SlackMode): boolean {
  return mode === "token";
}

/** Drop the Vault token line from a consent group in `mcp` mode, because no token is stored. */
export function slackConsentLines(
  lines: readonly string[],
  mode: SlackMode,
): string[] {
  return showsTokenFields(mode)
    ? [...lines]
    : lines.filter((line) => line !== SLACK_TOKEN_CONSENT_LINE);
}
