import { useRef, useState, type CSSProperties } from "react";
import type { ClaudeAccountSummary } from "../../../shared/types.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { AccountPopover } from "./AccountPopover.js";
import {
  emailLocalPart,
  formatReset,
  statusCopy,
  tightestWindow,
  toneColor,
  toneFor,
} from "./usage-format.js";

interface UsageChipProps {
  accounts: ClaudeAccountSummary[];
  activeId: string;
  compact?: boolean;
  onSwitch: (
    id: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onRefresh: (
    id: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onOpenSettings?: () => void;
}

const wrapperStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  flex: "0 1 auto",
  minWidth: 0,
};

const chipStyle: CSSProperties = {
  display: "inline-flex",
  overflow: "hidden",
  alignItems: "center",
  gap: "var(--space-xs)",
  height: "28px",
  padding: "0 var(--space-sm)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  background: "var(--surface-card)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-medium)",
  lineHeight: "var(--line-label)",
  cursor: "pointer",
  whiteSpace: "nowrap",
  minWidth: 0,
  transition: "var(--hover-transition)",
};

const dotStyle: CSSProperties = {
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  flex: "0 0 auto",
};

const summaryStyle: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 0,
};

const nameStyle: CSSProperties = {
  ...summaryStyle,
  color: "var(--text-muted)",
};

export function UsageChip({
  accounts,
  activeId,
  compact,
  onSwitch,
  onRefresh,
  onOpenSettings,
}: UsageChipProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const active = accounts.find((a) => a.id === activeId) ?? accounts[0];
  if (!active) return null;

  const usage = active.usage;
  const tightest = usage.status === "ok" ? tightestWindow(usage.windows) : null;
  const dotColor = tightest
    ? toneColor(toneFor(tightest.percent))
    : usage.status === "unavailable"
      ? "var(--text-muted)"
      : "var(--status-stale)";
  const reset = tightest ? formatReset(tightest.resetsAt) : null;
  const summary = tightest
    ? `${tightest.percent}% used${reset ? `, resets ${reset}` : ""}`
    : (statusCopy(usage) ?? "usage stale");
  const name = emailLocalPart(active.email);

  const handleClose = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div style={wrapperStyle}>
      <button
        ref={buttonRef}
        type="button"
        id="usage-chip"
        aria-label={`Claude account ${active.email}, ${summary}`}
        title={`${active.email}: ${summary}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="account-popover"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={(event) =>
          setFocused(event.currentTarget.matches(":focus-visible"))
        }
        onBlur={() => setFocused(false)}
        style={{
          ...chipStyle,
          background: hovered
            ? "var(--surface-card-hover)"
            : "var(--surface-card)",
          ...focusRing(focused),
        }}
      >
        <span
          aria-hidden="true"
          style={{ ...dotStyle, background: dotColor }}
        />
        <span data-testid="usage-chip-summary" style={summaryStyle}>
          {tightest ? `${tightest.percent}%` : summary}
        </span>
        {!compact && tightest && reset && (
          <span style={nameStyle}>{reset}</span>
        )}
        {!compact && <span style={nameStyle}>{name}</span>}
      </button>
      {open && (
        <AccountPopover
          accounts={accounts}
          activeId={activeId}
          onSwitch={onSwitch}
          onRefresh={onRefresh}
          onClose={handleClose}
          compact={compact}
          onOpenSettings={
            onOpenSettings
              ? () => {
                  setOpen(false);
                  onOpenSettings();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
