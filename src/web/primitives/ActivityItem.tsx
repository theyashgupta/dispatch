import { useState, type CSSProperties } from "react";
import {
  ArrowRight,
  ArrowRightLeft,
  Check,
  CircleAlert,
  CircleCheck,
  ClipboardCheck,
  Download,
  Play,
  RotateCw,
  TriangleAlert,
  Trash2,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import type { ActivityEvent, EventType } from "../../shared/types.js";
import { describeEvent } from "../lib/event-copy.js";
import { formatAge } from "../lib/format-age.js";

const EVENT_GLYPH: Record<EventType, LucideIcon> = {
  sync_in: Download,
  move_manual: ArrowRight,
  move_auto: ArrowRightLeft,
  status_needs_input: CircleAlert,
  status_agent_done: CircleCheck,
  status_done: Check,
  session_start: Play,
  session_resume: RotateCw,
  session_lost: Unplug,
  session_failed: TriangleAlert,
  resume_failed: TriangleAlert,
  plan_ready: ClipboardCheck,
  cleanup: Trash2,
};

const EVENT_TINT: Record<EventType, string> = {
  sync_in: "var(--text-muted)",
  move_manual: "var(--text-muted)",
  move_auto: "var(--text-muted)",
  status_needs_input: "var(--status-stale)",
  status_agent_done: "var(--status-ok)",
  status_done: "var(--text-muted)",
  session_start: "var(--text-muted)",
  session_resume: "var(--text-muted)",
  session_lost: "var(--destructive)",
  session_failed: "var(--destructive)",
  resume_failed: "var(--destructive)",
  plan_ready: "var(--text-muted)",
  cleanup: "var(--text-muted)",
};

interface ActivityItemProps {
  event: ActivityEvent;
  now: number;
  identifiers?: Record<string, string>;
  onSelect?: (cardId: string) => void;
}

const textBlockStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  wordBreak: "break-word",
};

export function ActivityItem({
  event,
  now,
  identifiers,
  onSelect,
}: ActivityItemProps) {
  const [hovered, setHovered] = useState(false);
  const Icon = EVENT_GLYPH[event.type];
  const interactive = onSelect != null && event.cardId != null;
  const label =
    event.cardId != null ? (identifiers?.[event.cardId] ?? event.cardId) : null;
  const age = formatAge(event.ts, now);

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: "var(--space-xs)",
    width: "100%",
    margin: 0,
    padding: 0,
    background:
      interactive && hovered ? "var(--surface-card-hover)" : "transparent",
    border: "none",
    textAlign: "left",
    font: "inherit",
    color: "var(--text)",
    cursor: interactive ? "pointer" : "default",
  };

  const content = (
    <>
      <Icon
        size={12}
        strokeWidth={2}
        aria-hidden
        style={{
          flex: "0 0 auto",
          marginTop: "1px",
          color: EVENT_TINT[event.type],
        }}
      />
      <span style={textBlockStyle}>
        {label != null && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--text)",
            }}
          >
            {label}{" "}
          </span>
        )}
        <span
          style={{ fontWeight: "var(--weight-regular)", color: "var(--text)" }}
        >
          {describeEvent(event)}
        </span>
        {age !== "" && (
          <span style={{ color: "var(--text-muted)" }}>{` · ${age}`}</span>
        )}
      </span>
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        style={rowStyle}
        onClick={() => {
          if (event.cardId != null) onSelect?.(event.cardId);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {content}
      </button>
    );
  }

  return <div style={rowStyle}>{content}</div>;
}
