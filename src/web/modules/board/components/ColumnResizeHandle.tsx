import { COLUMN_LABELS } from "@/components/badges/column-accent";
import { cn } from "@/lib/utils";
import type { Column as ColumnId } from "../../../../shared/types.js";
import {
  clampColumnWidth,
  COLUMN_WIDTH_MAX,
  COLUMN_WIDTH_MIN,
  COLUMN_WIDTH_STEP,
} from "@/modules/board/domain/column-widths";

interface ColumnResizeHandleProps {
  column: ColumnId;
  width: number;
  disabled: boolean;
  resizing: boolean;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizeKey: (width: number) => void;
  onReset: () => void;
}

export function ColumnResizeHandle({
  column,
  width,
  disabled,
  resizing,
  onResizeStart,
  onResizeKey,
  onReset,
}: ColumnResizeHandleProps) {
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    let next: number | null = null;
    if (event.key === "ArrowLeft") {
      next = clampColumnWidth(width - COLUMN_WIDTH_STEP);
    } else if (event.key === "ArrowRight") {
      next = clampColumnWidth(width + COLUMN_WIDTH_STEP);
    } else if (event.key === "Home") {
      next = COLUMN_WIDTH_MIN;
    } else if (event.key === "End") {
      next = COLUMN_WIDTH_MAX;
    }
    if (next == null) return;
    event.preventDefault();
    onResizeKey(next);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${COLUMN_LABELS[column]} column`}
      aria-valuenow={width}
      aria-valuemin={COLUMN_WIDTH_MIN}
      aria-valuemax={COLUMN_WIDTH_MAX}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!disabled) onResizeStart(event);
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onReset();
      }}
      onKeyDown={handleKeyDown}
      className={cn(
        "absolute top-0 right-0 z-2 h-full w-1.5 cursor-col-resize border-r-2 [transition:var(--resize-handle-transition)] focus:outline-2 focus:outline-offset-0 focus:outline-ring",
        resizing
          ? "border-(--accent)"
          : "border-transparent hover:border-(--hover-resize-handle)",
      )}
    />
  );
}
