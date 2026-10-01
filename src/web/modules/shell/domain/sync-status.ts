import type { ConnectionStatus } from "../../../../shared/types.js";

export type SyncTone = "down" | "reconnecting" | "stale" | "ok";

export interface SyncStatusInput {
  syncedAt: string | null;
  connection: ConnectionStatus;
  pollIntervalMs: number | null;
  syncWarning: string | null;
  syncUnreachable: boolean;
  noSource: boolean;
  now: number;
}

export type SyncSnapshot = Omit<SyncStatusInput, "now">;

export interface SyncStatusView {
  text: string;
  tone: SyncTone;
  dotTitle: string;
}

/**
 * Format how long ago a sync happened as "Synced just now", "Synced Ns ago" or "Synced Nm ago".
 */
export function formatSynced(syncedTs: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - syncedTs) / 1000));
  if (seconds < 5) return "Synced just now";
  if (seconds < 60) return `Synced ${seconds}s ago`;
  return `Synced ${Math.floor(seconds / 60)}m ago`;
}

/**
 * Derive the sidebar sync line, its dot tone and the dot tooltip, or null when there is nothing to show.
 *
 * @remarks Precedence is disconnected, then never synced, then unreachable, then an unparseable
 * timestamp, then stale, then the server warning, then the relative time. With no source enabled the
 * line stays empty unless the stream is disconnected.
 */
export function syncStatusView(input: SyncStatusInput): SyncStatusView | null {
  const {
    syncedAt,
    connection,
    pollIntervalMs,
    syncWarning,
    syncUnreachable,
    noSource,
    now,
  } = input;
  const disconnected = connection === "disconnected";
  if (noSource && !disconnected) return null;

  const syncedTs = syncedAt !== null ? new Date(syncedAt).getTime() : NaN;
  const syncedTsValid = Number.isFinite(syncedTs);
  const stale =
    !disconnected &&
    syncedTsValid &&
    pollIntervalMs != null &&
    now - syncedTs > 2 * pollIntervalMs;

  let text: string;
  if (disconnected) {
    text = "Disconnected, reconnecting…";
  } else if (syncedAt === null) {
    text = "Syncing…";
  } else if (syncUnreachable) {
    text = syncedTsValid
      ? `Reconnecting… (last synced ${formatSynced(syncedTs, now)})`
      : "Reconnecting…";
  } else if (!syncedTsValid) {
    text = "Synced";
  } else if (stale) {
    text = `Linear sync stale since ${new Date(syncedAt).toLocaleTimeString(
      [],
      { hour: "numeric", minute: "2-digit" },
    )}`;
  } else if (syncWarning) {
    text = syncWarning;
  } else {
    text = formatSynced(syncedTs, now);
  }

  if (disconnected) {
    return { text, tone: "down", dotTitle: "Disconnected, reconnecting…" };
  }
  if (syncUnreachable && syncedTsValid) {
    return { text, tone: "reconnecting", dotTitle: "Reconnecting…" };
  }
  if (stale) return { text, tone: "stale", dotTitle: "Sync stale" };
  return { text, tone: "ok", dotTitle: "Connected" };
}
