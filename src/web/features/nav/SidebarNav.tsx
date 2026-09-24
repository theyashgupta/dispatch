import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Activity,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
} from "lucide-react";
import type { ConnectionStatus } from "../../hooks/useBoardStream.js";
import type { Page, Route } from "../../lib/route.js";
import { Chip } from "../../primitives/Chip.js";
import { Spinner } from "../../primitives/Spinner.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { Glyph, wordmarkStyle } from "../../primitives/Glyph.js";
import { IconButton } from "../../primitives/IconButton.js";
import { NAV_ITEMS, navGroups } from "./nav-items.js";
import { NavRow } from "./NavRow.js";
import { SyncStatus } from "./SyncStatus.js";

interface SidebarNavProps {
  route: Route;
  onNavigate: (page: Page) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  inboxCount: number;
  liveSessionCount: number;
  syncedAt: string | null;
  connection: ConnectionStatus;
  pollIntervalMs: number | null;
  syncWarning: string | null;
  syncUnreachable?: boolean;
  accountSlot?: ReactNode;
  onOpenCreateTicket: () => void;
  onOpenActivity: () => void;
  activityUnseen: boolean;
  activityOpen: boolean;
  sheet?: boolean;
  collapsible?: boolean;
}

const navStyle: CSSProperties = {
  flex: "0 0 auto",
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  background: "var(--surface-column)",
  borderRight: "1px solid var(--border)",
  overflow: "hidden",
  transition: "width var(--motion-panel-open) var(--easing-enter)",
  userSelect: "none",
};

const identityStyle: CSSProperties = {
  flex: "0 0 var(--page-header-height)",
  height: "var(--page-header-height)",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  padding: "0 var(--space-lg)",
  color: "var(--text)",
  borderBottom: "1px solid var(--border)",
};

const rowsStyle: CSSProperties = {
  position: "relative",
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  padding: "var(--space-sm)",
};

const indicatorStyle: CSSProperties = {
  position: "absolute",
  left: "var(--space-sm)",
  right: "var(--space-sm)",
  top: 0,
  height: "32px",
  borderRadius: "var(--radius)",
  background: "color-mix(in srgb, var(--accent) 16%, var(--surface-column))",
  transition:
    "transform var(--motion-panel-open) var(--easing-enter), opacity var(--motion-count-change) var(--easing-enter)",
  pointerEvents: "none",
};

const groupLabelStyle: CSSProperties = {
  display: "block",
  padding: "var(--space-sm) var(--space-sm) var(--space-xs)",
  fontSize: "var(--font-micro)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

const groupDividerStyle: CSSProperties = {
  height: "1px",
  margin: "var(--space-sm) var(--space-xs)",
  background: "var(--border)",
};

const footerStyle: CSSProperties = {
  flex: "0 0 auto",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
  padding: "var(--space-sm)",
  borderTop: "1px solid var(--border)",
};

const footerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  minWidth: 0,
};

const newTicketStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-xs)",
  width: "100%",
  height: "28px",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  cursor: "pointer",
  outline: "none",
  whiteSpace: "nowrap",
};

const unseenDotStyle: CSSProperties = {
  position: "absolute",
  top: "2px",
  right: "2px",
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  background: "var(--status-ok)",
  pointerEvents: "none",
};

const GROUPS = navGroups(NAV_ITEMS);

export function SidebarNav({
  route,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  inboxCount,
  liveSessionCount,
  syncedAt,
  connection,
  pollIntervalMs,
  syncWarning,
  syncUnreachable,
  accountSlot,
  onOpenCreateTicket,
  onOpenActivity,
  activityUnseen,
  activityOpen,
  sheet = false,
  collapsible = true,
}: SidebarNavProps) {
  const rowRefs = useRef(new Map<Page, HTMLButtonElement>());
  const registerRow = useCallback(
    (page: Page) => (el: HTMLButtonElement | null) => {
      if (el == null) rowRefs.current.delete(page);
      else rowRefs.current.set(page, el);
    },
    [],
  );
  const [indicatorTop, setIndicatorTop] = useState<number | null>(null);
  const [newTicketHovered, setNewTicketHovered] = useState(false);
  const [newTicketFocused, setNewTicketFocused] = useState(false);

  useLayoutEffect(() => {
    const el = rowRefs.current.get(route.page);
    setIndicatorTop(el == null ? null : el.offsetTop);
  }, [route.page, collapsed]);

  return (
    <nav
      aria-label="Primary"
      style={{
        ...navStyle,
        width: sheet
          ? "100%"
          : collapsed
            ? "var(--nav-width-collapsed)"
            : "var(--nav-width)",
        borderRight: sheet ? "none" : navStyle.borderRight,
      }}
    >
      <div
        style={{
          ...identityStyle,
          justifyContent: collapsed ? "center" : "flex-start",
          padding: collapsed ? 0 : identityStyle.padding,
        }}
      >
        <Glyph size={16} title={collapsed ? "Dispatch" : undefined} />
        {collapsed ? null : <span style={wordmarkStyle}>DISPATCH</span>}
      </div>

      <div style={rowsStyle}>
        <div
          aria-hidden="true"
          style={{
            ...indicatorStyle,
            opacity: indicatorTop == null ? 0 : 1,
            transform: `translateY(${indicatorTop ?? 0}px)`,
          }}
        />
        {GROUPS.map((entry, index) => (
          <div key={entry.group}>
            {collapsed ? (
              index > 0 ? (
                <div aria-hidden="true" style={groupDividerStyle} />
              ) : null
            ) : (
              <span style={groupLabelStyle}>{entry.group}</span>
            )}
            {entry.items.map((item) => (
              <NavRow
                key={item.page}
                icon={item.icon}
                label={item.label}
                active={route.page === item.page}
                collapsed={collapsed}
                iconSlot={
                  item.page === "sessions" && liveSessionCount > 0 ? (
                    <Spinner />
                  ) : undefined
                }
                badge={
                  item.page === "inbox" && inboxCount > 0 ? (
                    <Chip tone="accent">{inboxCount}</Chip>
                  ) : item.page === "sessions" && liveSessionCount > 0 ? (
                    <Chip tone="accent">{liveSessionCount}</Chip>
                  ) : undefined
                }
                onSelect={() => onNavigate(item.page)}
                rowRef={registerRow(item.page)}
              />
            ))}
          </div>
        ))}
      </div>

      <div style={footerStyle}>
        <SyncStatus
          syncedAt={syncedAt}
          connection={connection}
          pollIntervalMs={pollIntervalMs}
          syncWarning={syncWarning}
          syncUnreachable={syncUnreachable}
          collapsed={collapsed}
        />
        {accountSlot != null && (
          <div
            style={{
              ...footerRowStyle,
              justifyContent: collapsed ? "center" : "flex-start",
            }}
          >
            {accountSlot}
          </div>
        )}
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
            ...newTicketStyle,
            background: newTicketHovered
              ? "var(--surface-card-hover)"
              : "var(--surface-card)",
            ...focusRing(newTicketFocused),
          }}
        >
          <Plus size={16} strokeWidth={2} aria-hidden="true" />
          {collapsed ? null : <span>New ticket</span>}
        </button>
        <div
          style={{
            ...footerRowStyle,
            justifyContent: collapsed ? "center" : "space-between",
          }}
        >
          <div style={{ position: "relative", display: "flex" }}>
            <IconButton
              id="activity-toggle"
              aria-label="Activity feed"
              title={activityUnseen ? "Activity: unseen" : "Activity"}
              aria-expanded={activityOpen}
              aria-controls="activity-drawer"
              onClick={onOpenActivity}
            >
              <Activity size={16} />
            </IconButton>
            {activityUnseen && (
              <span aria-hidden="true" style={unseenDotStyle} />
            )}
          </div>
          {collapsed || sheet || !collapsible ? null : (
            <IconButton
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              onClick={onToggleCollapsed}
            >
              <PanelLeftClose size={16} />
            </IconButton>
          )}
        </div>
        <NavRow
          icon={Settings}
          label="Settings"
          active={route.page === "settings"}
          collapsed={collapsed}
          onSelect={() => onNavigate("settings")}
          rowRef={registerRow("settings")}
        />
        {collapsed && !sheet && collapsible ? (
          <div style={{ ...footerRowStyle, justifyContent: "center" }}>
            <IconButton
              aria-label="Expand sidebar"
              title="Expand sidebar"
              onClick={onToggleCollapsed}
            >
              <PanelLeftOpen size={16} />
            </IconButton>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
