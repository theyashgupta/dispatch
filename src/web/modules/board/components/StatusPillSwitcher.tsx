import { COLUMNS } from "../../../../shared/types.js";
import type { Card, Column as ColumnId } from "../../../../shared/types.js";
import {
  COLUMN_ACCENT,
  COLUMN_LABELS,
} from "@/components/badges/column-accent";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

interface StatusPillSwitcherProps {
  cards: Card[];
  active: ColumnId | null;
  onSelect: (column: ColumnId) => void;
}

export function StatusPillSwitcher({
  cards,
  active,
  onSelect,
}: StatusPillSwitcherProps) {
  return (
    <nav
      aria-label="Jump to board column"
      className="flex flex-none items-center gap-(--space-sm) overflow-x-auto border-b border-border bg-background px-(--space-lg) py-(--space-sm)"
    >
      <ToggleGroup
        type="single"
        value={active ?? ""}
        rovingFocus={false}
        role={undefined}
        className="shrink-0 gap-(--space-sm)"
      >
        {COLUMNS.map((column) => {
          const count = cards.filter(
            (c) => c.column === column && c.groupId == null,
          ).length;
          const isActive = column === active;
          return (
            <ToggleGroupItem
              key={column}
              value={column}
              role={undefined}
              aria-checked={undefined}
              aria-current={isActive ? "true" : undefined}
              aria-label={`${COLUMN_LABELS[column]}, ${count} card${
                count === 1 ? "" : "s"
              }`}
              onClick={() => onSelect(column)}
              className="-my-2 h-auto rounded-none px-0 py-2 hover:bg-transparent hover:text-inherit data-[spacing=0]:first:rounded-l-none data-[spacing=0]:last:rounded-r-none data-[state=on]:bg-transparent data-[state=on]:text-inherit"
            >
              <span
                className={cn(
                  "inline-flex h-8 items-center gap-(--space-xs) rounded-md border bg-(--surface-column) px-(--space-sm) text-sm font-semibold tracking-[0.04em] whitespace-nowrap",
                  isActive
                    ? "border-(--accent) text-(--accent-text)"
                    : "border-border text-muted-foreground",
                )}
              >
                {COLUMN_LABELS[column]}
                <Badge
                  stateColor={COLUMN_ACCENT[column]}
                  className="h-auto rounded-sm border-0 bg-[color-mix(in_srgb,var(--badge-state)_16%,var(--surface-column))] px-(--space-xs) text-sm text-[color-mix(in_srgb,var(--badge-state)_35%,var(--text))]"
                >
                  {count}
                </Badge>
              </span>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </nav>
  );
}
