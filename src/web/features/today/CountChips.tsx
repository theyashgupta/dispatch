import type { CSSProperties } from "react";
import { Button } from "../../primitives/Button.js";
import { SourceBadge } from "../badges/index.js";
import type { SourceCount } from "./today-view.js";

interface CountChipsProps {
  chips: SourceCount[];
  filter: string | null;
  onFilterChange: (filter: string | null) => void;
}

const listStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-sm)",
};

const countStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
};

export function CountChips({ chips, filter, onFilterChange }: CountChipsProps) {
  if (chips.length === 0) return null;
  return (
    <div style={listStyle} role="group" aria-label="Filter by source">
      {chips.map(({ source, count }) => {
        const active = filter === source;
        return (
          <Button
            key={source}
            id={`today-chip-${source}`}
            variant="secondary"
            aria-pressed={active}
            onClick={() => onFilterChange(active ? null : source)}
          >
            <SourceBadge source={source} />
            <span style={countStyle}>{count}</span>
          </Button>
        );
      })}
    </div>
  );
}
