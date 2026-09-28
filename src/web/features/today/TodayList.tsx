import type { CSSProperties } from "react";
import type { TodayEntry } from "../../lib/p0.js";
import { Button } from "../../primitives/Button.js";
import { EntryRow } from "./EntryRow.js";
import type { Paged } from "./today-view.js";

interface TodayListProps {
  list: Paged<TodayEntry>;
  onPageChange: (page: number) => void;
  onOpen: (entry: TodayEntry) => void;
  now: number;
}

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
};

const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

const cardStyle: CSSProperties = {
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
};

const listStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const pagerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: "var(--space-sm)",
  padding: "var(--space-sm) var(--space-lg)",
  borderTop: "1px solid var(--border)",
};

const pageLabelStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  color: "var(--text-muted)",
};

export function TodayList({ list, onPageChange, onOpen, now }: TodayListProps) {
  const { rows, page: current, pages } = list;
  return (
    <section style={sectionStyle} aria-label="Top of your list">
      <h2 style={headingStyle}>Top of your list</h2>
      <div style={cardStyle}>
        <ul role="list" style={listStyle}>
          {rows.map((entry) => (
            <li key={entry.key}>
              <EntryRow
                entry={entry}
                id={`today-row-${entry.key}`}
                now={now}
                onOpen={onOpen}
              />
            </li>
          ))}
        </ul>
        <div style={pagerStyle}>
          <Button
            variant="secondary"
            disabled={current <= 1}
            onClick={() => onPageChange(current - 1)}
          >
            Previous
          </Button>
          <span style={pageLabelStyle}>
            Page {current} of {pages}
          </span>
          <Button
            variant="secondary"
            disabled={current >= pages}
            onClick={() => onPageChange(current + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}
