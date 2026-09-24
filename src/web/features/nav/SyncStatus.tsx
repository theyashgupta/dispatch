import { useEffect, useState, type CSSProperties } from "react";
import type { ConnectionStatus } from "../../hooks/useBoardStream.js";

interface SyncStatusProps {
  syncedAt: string | null;
  connection: ConnectionStatus;
  pollIntervalMs: number | null;
  syncWarning: string | null;
  syncUnreachable?: boolean;
  collapsed: boolean;
}

const regionStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  minWidth: 0,
  height: "32px",
  padding: "0 var(--space-sm)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-medium)",
  lineHeight: "var(--line-label)",
};

const dotStyle: CSSProperties = {
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  marginRight: "var(--space-xs)",
  flex: "0 0 auto",
};

const textStyle: CSSProperties = {
  minWidth: 0,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const hiddenTextStyle: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clipPath: "inset(50%)",
};

function formatSynced(syncedTs: number, now: number): string {
  const elapsedMs = now - syncedTs;
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 5) return "Synced just now";
  if (seconds < 60) return `Synced ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `Synced ${minutes}m ago`;
}

export function SyncStatus({
  syncedAt,
  connection,
  pollIntervalMs,
  syncWarning,
  syncUnreachable,
  collapsed,
}: SyncStatusProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const disconnected = connection === "disconnected";
  const syncedTs = syncedAt !== null ? new Date(syncedAt).getTime() : NaN;
  const syncedTsValid = Number.isFinite(syncedTs);
  const stale =
    !disconnected &&
    syncedAt !== null &&
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

  const dotColor = disconnected
    ? "var(--status-down)"
    : syncUnreachable && syncedTsValid
      ? "var(--accent)"
      : stale
        ? "var(--status-stale)"
        : "var(--status-ok)";
  const dotTitle = disconnected
    ? "Disconnected, reconnecting…"
    : syncUnreachable && syncedTsValid
      ? "Reconnecting…"
      : stale
        ? "Sync stale"
        : "Connected";

  return (
    <div
      role="status"
      aria-live="polite"
      title={collapsed ? text : undefined}
      style={{
        ...regionStyle,
        justifyContent: collapsed ? "center" : "flex-start",
        color: disconnected ? "var(--destructive-text)" : "var(--text-muted)",
      }}
    >
      <span
        title={dotTitle}
        style={{
          ...dotStyle,
          marginRight: collapsed ? 0 : dotStyle.marginRight,
          background: dotColor,
        }}
      />
      <span style={collapsed ? hiddenTextStyle : textStyle}>{text}</span>
    </div>
  );
}
