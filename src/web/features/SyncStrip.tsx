import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import type { ConnectionStatus } from "../hooks/useBoardStream.js";
import { Glyph } from "../primitives/Glyph.js";
import { IconButton } from "../primitives/IconButton.js";

interface SyncStripProps {
  syncedAt: string | null;
  connection: ConnectionStatus;
  pollIntervalMs: number | null;
  syncWarning: string | null;
  onOpenSettings?: () => void;
}

function formatSynced(syncedTs: number, now: number): string {
  const elapsedMs = now - syncedTs;
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 5) return "Synced just now";
  if (seconds < 60) return `Synced ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `Synced ${minutes}m ago`;
}

export function SyncStrip({
  syncedAt,
  connection,
  pollIntervalMs,
  syncWarning,
  onOpenSettings,
}: SyncStripProps) {
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
    text = "Disconnected — reconnecting…";
  } else if (syncedAt === null) {
    text = "Syncing…";
  } else if (!syncedTsValid) {
    text = "Synced";
  } else if (stale) {
    text = `Linear sync stale since ${new Date(syncedAt).toLocaleTimeString(
      [],
      {
        hour: "numeric",
        minute: "2-digit",
      },
    )}`;
  } else if (syncWarning) {
    text = syncWarning;
  } else {
    text = formatSynced(syncedTs, now);
  }

  const dotColor = disconnected
    ? "var(--status-down)"
    : stale
      ? "var(--status-stale)"
      : "var(--status-ok)";
  const dotTitle = disconnected
    ? "Disconnected — reconnecting…"
    : stale
      ? "Sync stale"
      : "Connected";

  return (
    <div
      style={{
        height: "var(--strip-height)",
        flex: "0 0 var(--strip-height)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 var(--space-lg)",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface-column)",
        fontSize: "var(--font-label)",
        fontWeight: "var(--weight-semibold)",
        lineHeight: "var(--line-label)",
        userSelect: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs)",
          color: "var(--text)",
        }}
      >
        <Glyph size={16} />
        <span
          style={{
            fontWeight: 800,
            fontSize: "12px",
            letterSpacing: "0.18em",
          }}
        >
          DISPATCH
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
        }}
      >
        <div
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            alignItems: "center",
            color: disconnected ? "var(--destructive)" : "var(--text-muted)",
          }}
        >
          <span
            title={dotTitle}
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: dotColor,
              marginRight: "var(--space-xs)",
              flex: "0 0 auto",
            }}
          />
          {text}
        </div>
        <IconButton aria-label="Sync filters" onClick={onOpenSettings}>
          <Settings size={16} />
        </IconButton>
      </div>
    </div>
  );
}
