import { useState, type CSSProperties } from "react";
import { formatAge } from "../../lib/format-age.js";
import type { TodayEntry } from "../../lib/p0.js";
import { Chip } from "../../primitives/Chip.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { SourceBadge } from "../../components/badges/index.js";

interface EntryRowProps {
  entry: TodayEntry;
  id: string;
  number?: number;
  now: number;
  onOpen: (entry: TodayEntry) => void;
}

const rowButtonStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
  width: "100%",
  padding: "var(--space-sm) var(--space-lg)",
  background: "transparent",
  border: "none",
  borderTop: "1px solid var(--border)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  textAlign: "left",
  cursor: "pointer",
  outline: "none",
  transition: "var(--hover-transition)",
};

const topLineStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  minWidth: 0,
};

const numberStyle: CSSProperties = {
  flex: "0 0 auto",
  color: "var(--text-muted)",
  fontSize: "var(--font-label)",
};

const titleStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "var(--font-body)",
};

const metaLineStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--space-xs)",
};

const actionStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--font-label)",
};

const timeStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--font-micro)",
};

export function EntryRow({ entry, id, number, now, onOpen }: EntryRowProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <button
      type="button"
      id={id}
      onClick={() => onOpen(entry)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={(event) =>
        setFocused(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setFocused(false)}
      style={{
        ...rowButtonStyle,
        background: hovered ? "var(--surface-card-hover)" : "transparent",
        ...focusRing(focused, true),
      }}
    >
      <span style={topLineStyle}>
        {number != null && <span style={numberStyle}>{number}</span>}
        <SourceBadge source={entry.source} />
        <span style={titleStyle}>{entry.title}</span>
      </span>
      <span style={metaLineStyle}>
        {entry.chips.map((chip, chipIndex) => (
          <Chip key={chipIndex}>{chip}</Chip>
        ))}
        <span style={actionStyle}>{entry.actionLabel}</span>
        <span style={timeStyle}>{formatAge(entry.time, now)}</span>
      </span>
    </button>
  );
}
