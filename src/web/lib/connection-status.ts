import type {
  GranolaCheckState,
  GranolaError,
  GranolaStatus,
  SourceCardStatus,
  SourceConnection,
  SourceKeyError,
} from "../../shared/types.js";
import { formatAge } from "./format-age.js";

export const CONNECTION_ERROR_COPY: Record<SourceKeyError, string> = {
  rejected: "Linear rejected that key. Double-check it and try again.",
  unreachable: "Couldn't reach Linear. Check your connection and try again.",
  superseded:
    "Linear was disconnected while this key was being checked. Paste it again to reconnect.",
  failed:
    "Dispatch couldn't save the key. Check ~/.dispatch/config.json and try again.",
};

/**
 * Map the server's connection report to the status a connection card shows.
 *
 * @remarks An error report wins over the configured flag, so a failed first read shows the error
 * instead of passing for a source that was never connected.
 */
export function cardStatusFrom(
  connection: SourceConnection | null,
): SourceCardStatus {
  if (connection === null) return { kind: "checking" };
  if (connection.connected) {
    return connection.account
      ? { kind: "connected", account: connection.account }
      : { kind: "connected" };
  }
  if (connection.error) {
    return { kind: "error", message: CONNECTION_ERROR_COPY[connection.error] };
  }
  return { kind: "disconnected" };
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
