import { useEffect, useState, type CSSProperties } from "react";
import type { Card as CardModel } from "../../../shared/types.js";
import { switchSession } from "../../lib/api.js";
import { IconButton } from "../../primitives/IconButton.js";

const containerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  height: "28px",
  padding: "2px",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  overflowX: "auto",
};

const segmentStyle: CSSProperties = {
  width: "24px",
  height: "24px",
  borderRadius: "var(--radius-sm)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
};

const activeSegmentTint =
  "color-mix(in srgb, var(--accent) 16%, var(--surface-column))";

interface SessionSwitcherProps {
  card: CardModel;
}

export function SessionSwitcher({ card }: SessionSwitcherProps) {
  const [optimisticId, setOptimisticId] = useState<string | null>(null);

  useEffect(() => {
    if (optimisticId != null && card.activeSessionId === optimisticId) {
      setOptimisticId(null);
    }
  }, [card.activeSessionId, optimisticId]);

  const entries = card.sessionSummaries ?? [];
  const activeId = optimisticId ?? card.activeSessionId;

  return (
    <div style={containerStyle} role="group" aria-label="Sessions">
      {entries.map((entry) => {
        const active = entry.id === activeId;
        const label = entry.lost
          ? `Session ${entry.ordinal} — lost`
          : `Session ${entry.ordinal}`;
        return (
          <IconButton
            key={entry.id}
            aria-label={label}
            title={label}
            aria-pressed={active}
            onClick={() => {
              setOptimisticId(entry.id);
              switchSession(card.id, entry.id).catch(console.error);
            }}
            style={{
              ...segmentStyle,
              color: active
                ? "var(--accent)"
                : entry.lost
                  ? "var(--destructive)"
                  : "var(--text-muted)",
              ...(active ? { background: activeSegmentTint } : {}),
            }}
          >
            {entry.ordinal}
          </IconButton>
        );
      })}
    </div>
  );
}
