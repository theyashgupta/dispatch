import {
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { PANEL_MIN_WIDTH_PX } from "@/modules/detail/domain/panel-width";

interface PanelResizeHandleProps {
  open: boolean;
  coarsePointer: boolean;
  resizing: boolean;
  currentWidthPx: number | null;
  maxWidthPx: number;
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onDoubleClick: (e: MouseEvent<HTMLDivElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
}

export function PanelResizeHandle({
  open,
  coarsePointer,
  resizing,
  currentWidthPx,
  maxWidthPx,
  onPointerDown,
  onDoubleClick,
  onKeyDown,
}: PanelResizeHandleProps) {
  const [hovering, setHovering] = useState(false);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={
        currentWidthPx != null ? Math.round(currentWidthPx) : undefined
      }
      aria-valuemin={PANEL_MIN_WIDTH_PX}
      aria-valuemax={Math.round(maxWidthPx)}
      aria-hidden={!open}
      tabIndex={open ? 0 : -1}
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={onDoubleClick}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      onKeyDown={onKeyDown}
      className={cn(
        "absolute top-0 left-0 z-3 h-full cursor-col-resize touch-none border-l-2 bg-transparent outline-none [transition:var(--resize-handle-transition)] focus:outline-2 focus:outline-offset-2 focus:outline-ring focus:outline-solid",
        coarsePointer ? "w-(--space-xl)" : "w-2",
        resizing
          ? "border-l-(--accent)"
          : hovering
            ? "border-l-(--hover-resize-handle)"
            : "border-l-transparent",
      )}
    >
      {coarsePointer && (
        <GripVertical
          strokeWidth={2}
          aria-hidden="true"
          className="absolute top-1/2 left-1/2 size-3.5 [transform:translate(-50%,-50%)] text-muted-foreground"
        />
      )}
    </div>
  );
}
