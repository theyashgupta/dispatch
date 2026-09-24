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
