import { useState } from "react";
import type { Card as CardModel } from "../../../../shared/types.js";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

interface SessionSwitcherProps {
  card: CardModel;
  onSwitch: (cardId: string, sessionId: string) => void;
}

const SEGMENT_CLASS =
  "size-6 min-w-0 px-0 text-sm leading-(--line-label) font-semibold data-[spacing=0]:rounded-(--radius-sm) data-[spacing=0]:first:rounded-l-(--radius-sm) data-[spacing=0]:last:rounded-r-(--radius-sm)";

export function SessionSwitcher({ card, onSwitch }: SessionSwitcherProps) {
  const [optimisticId, setOptimisticId] = useState<string | null>(null);

  if (optimisticId != null && card.activeSessionId === optimisticId) {
    setOptimisticId(null);
  }

  const entries = card.sessionSummaries ?? [];
  const activeId = optimisticId ?? card.activeSessionId;
  const activeEntry = entries.find((e) => e.id === activeId);

  return (
    <div className="flex max-w-full items-center gap-(--space-xs) overflow-x-auto">
      <ToggleGroup
        type="multiple"
        role="group"
        aria-label="Sessions"
        rovingFocus={false}
        value={activeId != null ? [activeId] : []}
        className="h-7 overflow-x-auto rounded-md border border-border bg-card p-0.5"
      >
        {entries.map((entry) => {
          const active = entry.id === activeId;
          let label = entry.lost
            ? `Session ${entry.ordinal} (lost)`
            : `Session ${entry.ordinal}`;
          if (entry.parentOrdinal != null) {
            label += `, built from Session ${entry.parentOrdinal}`;
          }
          return (
            <ToggleGroupItem
              key={entry.id}
              value={entry.id}
              aria-label={label}
              title={label}
              onClick={() => {
                setOptimisticId(entry.id);
                onSwitch(card.id, entry.id);
              }}
              className={cn(
                SEGMENT_CLASS,
                active
                  ? "bg-[color-mix(in_srgb,var(--accent)_16%,var(--surface-column))] text-(--accent-text) hover:bg-[color-mix(in_srgb,var(--accent)_22%,var(--surface-column))] hover:text-(--accent-text) data-[state=on]:bg-[color-mix(in_srgb,var(--accent)_16%,var(--surface-column))] data-[state=on]:text-(--accent-text) data-[state=on]:hover:bg-[color-mix(in_srgb,var(--accent)_22%,var(--surface-column))]"
                  : entry.lost
                    ? "text-destructive-text hover:bg-accent hover:text-destructive-text"
                    : "text-muted-foreground hover:bg-accent hover:text-muted-foreground",
              )}
            >
              {entry.ordinal}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
      {activeEntry?.parentOrdinal != null && (
        <span className="flex-none text-sm whitespace-nowrap text-muted-foreground">
          {`· from ${activeEntry.parentOrdinal}`}
        </span>
      )}
    </div>
  );
}
