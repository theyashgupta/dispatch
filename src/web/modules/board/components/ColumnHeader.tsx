import { useEffect, useRef, useState } from "react";
import type { Column as ColumnId } from "../../../../shared/types.js";
import {
  COLUMN_ACCENT,
  COLUMN_LABELS,
} from "@/components/badges/column-accent";
import { Badge } from "@/components/ui/badge";
import { useCssVars } from "@/components/ui/hooks/use-css-vars";
import { cn } from "@/lib/utils";

interface ColumnHeaderProps {
  column: ColumnId;
  count: number;
  manualEntryBlocked: boolean;
}

export function ColumnHeader({
  column,
  count,
  manualEntryBlocked,
}: ColumnHeaderProps) {
  const accentVars = useCssVars({ "--column-accent": COLUMN_ACCENT[column] });
  const prevCountRef = useRef(count);
  const [countPulse, setCountPulse] = useState(0);
  useEffect(() => {
    if (prevCountRef.current !== count) {
      prevCountRef.current = count;
      setCountPulse((n) => n + 1);
    }
  }, [count]);

  return (
    <div className="sticky top-0 z-1 flex h-(--column-header-height) shrink-0 items-center gap-(--space-xs) bg-(--surface-column) text-sm font-medium tracking-[0.04em] text-muted-foreground select-none">
      <span
        ref={accentVars}
        className="border-b-2 border-(--column-accent) pb-0.5"
      >
        {COLUMN_LABELS[column]}
      </span>
      <Badge
        key={countPulse}
        stateColor={COLUMN_ACCENT[column]}
        className={cn(
          "h-auto rounded-sm border-0 bg-[color-mix(in_srgb,var(--badge-state)_16%,var(--surface-column))] px-(--space-xs) text-xs font-medium text-[color-mix(in_srgb,var(--badge-state)_35%,var(--text))]",
          countPulse > 0 &&
            "animate-[count-pulse_var(--motion-count-change)_var(--easing-enter)]",
        )}
      >
        {count}
      </Badge>
      {manualEntryBlocked && (
        <span
          title="Agent Done is set automatically by a real agent completion signal. It is never a manual drop target"
          className="min-w-0 truncate text-sm font-normal whitespace-nowrap text-muted-foreground"
        >
          Automatic only
        </span>
      )}
    </div>
  );
}
