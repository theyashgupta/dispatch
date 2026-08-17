import { useEffect, useState, type CSSProperties } from "react";
import {
  Activity,
  Inbox,
  Kanban,
  PanelLeft,
  Plus,
  Settings,
} from "lucide-react";
import type { ConnectionStatus } from "../../hooks/useBoardStream.js";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { Glyph, wordmarkStyle } from "../../primitives/Glyph.js";
import { IconButton } from "../../primitives/IconButton.js";

const stripContainerStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "var(--strip-grid-columns)",
  alignItems: "center",
  height: "var(--strip-height)",
  flex: "0 0 var(--strip-height)",
  padding: "0 var(--strip-padding)",
  borderBottom: "1px solid var(--border)",
  background: "var(--surface-column)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  userSelect: "none",
};

const identityZoneStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  color: "var(--text)",
};

const modeControlStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifySelf: "center",
  height: "28px",
  padding: "2px",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
};

const viewSegmentStyle: CSSProperties = {
  width: "28px",
  height: "24px",
  borderRadius: "var(--radius-sm)",
};

const activeSegmentTint =
  "color-mix(in srgb, var(--accent) 16%, var(--surface-column))";

const rightZoneStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  minWidth: 0,
};

const primaryClusterStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
};

const utilityClusterStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  minWidth: 0,
};

const dividerStyle: CSSProperties = {
  width: "1px",
  height: "20px",
  background: "var(--border)",
  flex: "0 0 auto",
};

const newTicketBaseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  flex: "0 0 auto",
  height: "28px",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  cursor: "pointer",
  outline: "none",
};

const newTicketLabelledStyle: CSSProperties = {
  padding: "0 var(--space-sm)",
};

const newTicketIconOnlyStyle: CSSProperties = {
  padding: 0,
  width: "28px",
  justifyContent: "center",
};

interface SyncStripProps {
  syncedAt: string | null;
  connection: ConnectionStatus;
  pollIntervalMs: number | null;
  syncWarning: string | null;
  syncUnreachable?: boolean;
  onOpenSettings?: () => void;
  onOpenActivity?: () => void;
  activityUnseen?: boolean;
  activityOpen?: boolean;
  onOpenInbox?: () => void;
  inboxCount?: number;
  inboxOpen?: boolean;
  onOpenCreateTicket: () => void;
  viewMode?: "board" | "workspace";
  onSelectViewMode?: (mode: "board" | "workspace") => void;
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
  syncUnreachable,
  onOpenSettings,
  onOpenActivity,
  activityUnseen,
  activityOpen,
  onOpenInbox,
  inboxCount,
  inboxOpen,
  onOpenCreateTicket,
  viewMode,
  onSelectViewMode,
}: SyncStripProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const narrow = useMediaQuery("(max-width: 767px)");
  const clusterGap = narrow ? "var(--space-sm)" : "var(--space-lg)";
  const itemGap = narrow ? "var(--space-xs)" : "var(--space-sm)";
  const iconOnly = useMediaQuery("(max-width: 1023px)");
  const [newTicketHovered, setNewTicketHovered] = useState(false);
  const [newTicketFocused, setNewTicketFocused] = useState(false);

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
  } else if (syncUnreachable) {
    text = syncedTsValid
      ? `Reconnecting… (last synced ${formatSynced(syncedTs, now)})`
      : "Reconnecting…";
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
    : syncUnreachable && syncedTsValid
      ? "var(--accent)"
      : stale
        ? "var(--status-stale)"
        : "var(--status-ok)";
  const dotTitle = disconnected
    ? "Disconnected — reconnecting…"
    : syncUnreachable && syncedTsValid
      ? "Reconnecting…"
      : stale
        ? "Sync stale"
        : "Connected";

  return (
    <div style={stripContainerStyle}>
      <div style={identityZoneStyle}>
        <Glyph size={16} title={narrow ? "Dispatch" : undefined} />
        {narrow ? null : <span style={wordmarkStyle}>DISPATCH</span>}
      </div>
      <div style={modeControlStyle} role="group" aria-label="View">
        <IconButton
          aria-label="Board view"
          title="Board view"
          aria-pressed={viewMode === "board"}
          onClick={() => onSelectViewMode?.("board")}
          style={{
            ...viewSegmentStyle,
            color: viewMode === "board" ? "var(--accent)" : "var(--text-muted)",
            ...(viewMode === "board" ? { background: activeSegmentTint } : {}),
          }}
        >
          <Kanban size={16} />
        </IconButton>
        <IconButton
          aria-label="Workspace view"
          title="Workspace view"
          aria-pressed={viewMode === "workspace"}
          onClick={() => onSelectViewMode?.("workspace")}
          style={{
            ...viewSegmentStyle,
            color:
              viewMode === "workspace" ? "var(--accent)" : "var(--text-muted)",
            ...(viewMode === "workspace"
              ? { background: activeSegmentTint }
              : {}),
          }}
        >
          <PanelLeft size={16} />
        </IconButton>
      </div>
      <div style={{ ...rightZoneStyle, gap: clusterGap }}>
        <div style={{ ...primaryClusterStyle, gap: itemGap }}>
          <button
            type="button"
            aria-label="New ticket"
            title="New ticket"
            onClick={onOpenCreateTicket}
            onMouseEnter={() => setNewTicketHovered(true)}
            onMouseLeave={() => setNewTicketHovered(false)}
            onFocus={(event) =>
              setNewTicketFocused(event.currentTarget.matches(":focus-visible"))
            }
            onBlur={() => setNewTicketFocused(false)}
            style={{
              ...newTicketBaseStyle,
              ...(iconOnly ? newTicketIconOnlyStyle : newTicketLabelledStyle),
              background: newTicketHovered
                ? "var(--surface-card-hover)"
                : "var(--surface-card)",
              ...focusRing(newTicketFocused),
            }}
          >
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
            {iconOnly ? null : <span>New ticket</span>}
          </button>
          {viewMode === "board" && (
            <div style={{ position: "relative", display: "flex" }}>
              <IconButton
                id="inbox-toggle"
                aria-label={
                  inboxOpen
                    ? "Close inbox, return to board"
                    : inboxCount != null && inboxCount > 0
                      ? `Open inbox, ${inboxCount} ticket${inboxCount === 1 ? "" : "s"}`
                      : "Open inbox"
                }
                title={
                  inboxCount != null && inboxCount > 0
                    ? `Inbox — ${inboxCount} ticket${inboxCount === 1 ? "" : "s"}`
                    : "Inbox"
                }
                aria-expanded={inboxOpen}
                aria-controls="inbox-view"
                onClick={onOpenInbox}
                style={{
                  color: inboxOpen ? "var(--accent)" : "var(--text-muted)",
                  ...(inboxOpen ? { background: activeSegmentTint } : {}),
                }}
              >
                <Inbox size={16} />
              </IconButton>
              {inboxCount != null && inboxCount > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: "2px",
                    right: "2px",
                    background:
                      "color-mix(in srgb, var(--accent) 16%, var(--surface-column))",
                    color: "var(--accent)",
                    borderRadius: "var(--radius-sm)",
                    padding: "0 var(--space-xs)",
                    fontSize: "var(--font-label)",
                    fontWeight: "var(--weight-semibold)",
                    lineHeight: "var(--line-label)",
                    pointerEvents: "none",
                  }}
                >
                  {inboxCount}
                </span>
              )}
            </div>
          )}
        </div>
        <span aria-hidden="true" style={dividerStyle} />
        <div style={{ ...utilityClusterStyle, gap: itemGap }}>
          <div
            role="status"
            aria-live="polite"
            style={{
              display: "flex",
              alignItems: "center",
              minWidth: 0,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: disconnected ? "var(--destructive)" : "var(--text-muted)",
              fontWeight: "var(--weight-medium)",
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
          <div style={{ position: "relative", display: "flex" }}>
            <IconButton
              id="activity-toggle"
              aria-label="Activity feed"
              title={activityUnseen ? "Activity — unseen" : "Activity"}
              aria-expanded={activityOpen}
              aria-controls="activity-drawer"
              onClick={onOpenActivity}
            >
              <Activity size={16} />
            </IconButton>
            {activityUnseen && (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: "2px",
                  right: "2px",
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: "var(--status-ok)",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
          <IconButton
            aria-label="Sync filters"
            title="Settings"
            onClick={onOpenSettings}
          >
            <Settings size={16} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
