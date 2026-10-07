import { useCallback } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Column as ColumnId } from "../../../../../shared/types.js";
import { cn } from "@/lib/utils";
import { useColumnResize } from "@/modules/board/hooks/use-column-widths";
import { ColumnHeader } from "../ColumnHeader";
import { ColumnResizeHandle } from "../ColumnResizeHandle";

interface DroppableColumnProps {
  column: ColumnId;
  count: number;
  manualEntryBlocked: boolean;
  refusedDrop: boolean;
  resizeDisabled: boolean;
  isCarousel: boolean;
  phone: boolean;
  large: boolean;
  children: React.ReactNode;
}

export function DroppableColumn({
  column,
  count,
  manualEntryBlocked,
  refusedDrop,
  resizeDisabled,
  isCarousel,
  phone,
  large,
  children,
}: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  const highlight = isOver && !manualEntryBlocked;
  const refusing = manualEntryBlocked && (isOver || refusedDrop);
  const {
    columnRef,
    persistedWidth,
    width,
    resizing,
    onResizeStart,
    onResizeKey,
    onReset,
  } = useColumnResize(column, resizeDisabled);
  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      columnRef(node);
    },
    [setNodeRef, columnRef],
  );

  return (
    <div
      ref={setRootRef}
      data-column={column}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-md border px-(--space-lg) pb-(--space-lg) shadow-(--shadow-column-edge)",
        highlight
          ? "border-(--accent) bg-[color-mix(in_srgb,var(--accent)_12%,var(--surface-column))]"
          : refusing
            ? "border-(--status-stale) bg-[color-mix(in_srgb,var(--status-stale)_8%,var(--surface-column))]"
            : "border-transparent bg-(--surface-column)",
        !isCarousel && (persistedWidth != null || resizing)
          ? "w-(--column-width) flex-none"
          : isCarousel
            ? cn(
                "snap-start snap-always",
                phone ? "flex-[0_0_90vw]" : "flex-[0_0_80vw]",
              )
            : large
              ? "max-w-[360px] min-w-[240px] flex-[1_1_0]"
              : "min-w-[220px] flex-[1_1_0]",
      )}
    >
      {!isCarousel && (
        <ColumnResizeHandle
          column={column}
          width={width}
          disabled={resizeDisabled}
          resizing={resizing}
          onResizeStart={onResizeStart}
          onResizeKey={onResizeKey}
          onReset={onReset}
        />
      )}
      <ColumnHeader
        column={column}
        count={count}
        manualEntryBlocked={manualEntryBlocked}
      />
      {refusing && (
        <div
          role="status"
          className="mb-(--space-sm) flex-none rounded-md border border-(--status-stale) bg-[color-mix(in_srgb,var(--status-stale)_14%,var(--surface-column))] px-(--space-sm) py-(--space-xs) text-sm font-normal text-(--text)"
        >
          Can’t drop here. A card only reaches Agent Done on a real agent
          completion signal.
        </div>
      )}
      <div className="scroll-stable-y -mx-(--space-xs) flex flex-auto flex-col gap-(--inter-card-gap) overflow-y-auto p-(--space-xs)">
        {children}
      </div>
    </div>
  );
}
