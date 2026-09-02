import { useEffect, useRef, useState, type CSSProperties } from "react";
import { RefreshCw } from "lucide-react";
import type { ClaudeAccountSummary } from "../../../shared/types.js";
import { Button } from "../../primitives/Button.js";
import { IconButton } from "../../primitives/IconButton.js";
import { formatReset, statusCopy, toneColor, toneFor } from "./usage-format.js";

interface AccountPopoverProps {
  accounts: ClaudeAccountSummary[];
  activeId: string;
  onSwitch: (
    id: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onRefresh: (
    id: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onClose: () => void;
  onOpenSettings?: () => void;
  compact?: boolean;
}

const compactPanelStyle: CSSProperties = {
  position: "fixed",
  top: "calc(var(--strip-height) + var(--space-xs))",
  left: "var(--strip-padding)",
  right: "var(--strip-padding)",
  width: "auto",
};

const panelStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + var(--space-xs))",
  right: 0,
  zIndex: 30,
  width: "min(360px, calc(100vw - 2 * var(--strip-padding)))",
  maxHeight: "70vh",
  overflowY: "auto",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-float)",
  padding: "var(--space-sm)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  color: "var(--text)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  fontWeight: "var(--weight-regular)",
  textAlign: "left",
  cursor: "default",
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
  padding: "var(--space-xs) var(--space-sm)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  minWidth: 0,
};

const emailStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontWeight: "var(--weight-semibold)",
};

const badgeStyle: CSSProperties = {
  flex: "0 0 auto",
  padding: "0 var(--space-xs)",
  borderRadius: "var(--radius-sm)",
  background: "color-mix(in srgb, var(--accent) 16%, var(--surface-column))",
  color: "var(--accent)",
  fontSize: "var(--font-micro)",
  fontWeight: "var(--weight-semibold)",
};

const windowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(72px, auto) 1fr auto auto",
  alignItems: "center",
  gap: "var(--space-xs)",
  color: "var(--text-muted)",
};

const barTrackStyle: CSSProperties = {
  height: "5px",
  borderRadius: "var(--radius-sm)",
  background: "var(--border)",
  overflow: "hidden",
};

const mutedStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--font-micro)",
};

export function AccountPopover({
  accounts,
  activeId,
  onSwitch,
  onRefresh,
  onClose,
  onOpenSettings,
  compact,
}: AccountPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      const trigger = root?.parentElement;
      if (
        root &&
        !root.contains(event.target as Node) &&
        !trigger?.contains(event.target as Node)
      ) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleSwitch = async (id: string) => {
    setBusyId(id);
    const result = await onSwitch(id);
    setBusyId(null);
    setNotice(result.ok ? null : result.error);
  };

  const handleRefresh = async (id: string) => {
    setBusyId(id);
    const result = await onRefresh(id);
    setBusyId(null);
    setNotice(result.ok ? null : result.error);
  };

  return (
    <div
      ref={rootRef}
      id="account-popover"
      role="dialog"
      aria-label="Claude accounts and usage"
      style={compact ? { ...panelStyle, ...compactPanelStyle } : panelStyle}
    >
      {notice && (
        <div role="alert" style={{ color: "var(--destructive-text)" }}>
          {notice}
        </div>
      )}
      {accounts.map((account) => {
        const isActive = account.id === activeId;
        const copy = statusCopy(account.usage);
        return (
          <div key={account.id} style={rowStyle} data-account-id={account.id}>
            <div style={headerStyle}>
              <span style={emailStyle} title={account.email}>
                {account.email}
              </span>
              {isActive && <span style={badgeStyle}>Active</span>}
              <IconButton
                aria-label={`Refresh usage for ${account.email}`}
                title="Refresh usage"
                disabled={busyId === account.id}
                onClick={() => void handleRefresh(account.id)}
              >
                <RefreshCw size={14} />
              </IconButton>
              {!isActive && (
                <Button
                  variant="secondary"
                  disabled={busyId === account.id}
                  onClick={() => void handleSwitch(account.id)}
                >
                  Switch
                </Button>
              )}
            </div>
            {account.usage.windows.map((w) => {
              const reset = formatReset(w.resetsAt);
              return (
                <div key={`${w.kind}:${w.label}`} style={windowStyle}>
                  <span>{w.label}</span>
                  <div style={barTrackStyle} aria-hidden="true">
                    <div
                      style={{
                        width: `${w.percent}%`,
                        height: "100%",
                        background: toneColor(toneFor(w.percent)),
                      }}
                    />
                  </div>
                  <span style={{ color: "var(--text)" }}>{w.percent}%</span>
                  <span style={mutedStyle}>
                    {reset ? `resets ${reset}` : ""}
                  </span>
                </div>
              );
            })}
            <span style={mutedStyle}>
              {copy ??
                (account.usage.fetchedAt
                  ? `Checked ${new Date(account.usage.fetchedAt).toLocaleTimeString()}`
                  : "")}
              {account.subscriptionType ? ` · ${account.subscriptionType}` : ""}
            </span>
          </div>
        );
      })}
      {onOpenSettings && (
        <Button variant="secondary" onClick={onOpenSettings}>
          Manage accounts
        </Button>
      )}
    </div>
  );
}
