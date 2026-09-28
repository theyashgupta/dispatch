import type { CSSProperties } from "react";
import type { TodayEntry, TodayWindow } from "../../lib/p0.js";
import { Button } from "../../primitives/Button.js";
import { Select } from "../../primitives/Select.js";
import { EntryRow } from "./EntryRow.js";

interface P0CardProps {
  entries: TodayEntry[];
  poolSize: number;
  range: TodayWindow;
  onRangeChange: (range: TodayWindow) => void;
  count: number;
  onCountChange: (count: number) => void;
  onOpen: (entry: TodayEntry) => void;
  now: number;
}

const COUNT_LABELS: Record<"3" | "4" | "5", string> = {
  "3": "3",
  "4": "4",
  "5": "5",
};

const cardStyle: CSSProperties = {
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-sm)",
  padding: "var(--space-lg)",
};

const titleGroupStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--space-xs)",
  minWidth: 0,
};

const titleStyle: CSSProperties = {
  fontSize: "var(--font-body)",
  fontWeight: "var(--weight-semibold)",
  color: "var(--text)",
};

const countStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  color: "var(--text-muted)",
};

const controlsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--space-sm)",
};

const toggleGroupStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-xs)",
};

const rowsStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const emptyStyle: CSSProperties = {
  padding: "var(--space-lg)",
  color: "var(--text-muted)",
  fontSize: "var(--font-body)",
};

export function P0Card({
  entries,
  poolSize,
  range,
  onRangeChange,
  count,
  onCountChange,
  onOpen,
  now,
}: P0CardProps) {
  return (
    <section style={cardStyle} aria-label="P0">
      <div style={headerStyle}>
        <div style={titleGroupStyle}>
          <span style={titleStyle}>P0</span>
          <span style={countStyle}>
            {entries.length} of {poolSize}
          </span>
        </div>
        <div style={controlsStyle}>
          <div role="group" aria-label="Window" style={toggleGroupStyle}>
            <Button
              variant="secondary"
              aria-pressed={range === "today"}
              onClick={() => onRangeChange("today")}
            >
              Today
            </Button>
            <Button
              variant="secondary"
              aria-pressed={range === "week"}
              onClick={() => onRangeChange("week")}
            >
              This week
            </Button>
          </div>
          <Select
            label="Show"
            value={String(count) as "3" | "4" | "5"}
            labels={COUNT_LABELS}
            onChange={(value) => onCountChange(Number(value))}
          />
        </div>
      </div>
      {entries.length === 0 ? (
        <p style={emptyStyle}>Nothing needs you right now.</p>
      ) : (
        <ol role="list" style={rowsStyle}>
          {entries.map((entry, index) => (
            <li key={entry.key}>
              <EntryRow
                entry={entry}
                id={`p0-row-${entry.key}`}
                number={index + 1}
                now={now}
                onOpen={onOpen}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
