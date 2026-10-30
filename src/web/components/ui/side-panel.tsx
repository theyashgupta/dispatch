import {
  useEffect,
  type ReactNode,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { cn } from "cn";
import { GripVertical, Maximize2, Minimize2 } from "lucide-react";
import { sidePanelEscapeAction } from "../../../shared/side-panel-escape.js";
import { PANEL_MIN_WIDTH_PX } from "../../../shared/side-panel-width.js";
import { Button } from "./button";
import { useMediaQuery } from "./hooks/use-media-query";
import { useSidePanelWidth } from "./hooks/use-side-panel-width";

const OPEN_OVERLAY_SELECTOR = 'aside[data-side-panel="overlay"]:not([inert])';

const DOCKED_GEOMETRY =
  "top-[var(--chrome-top,var(--page-header-height))] left-[calc(var(--nav-current,0px)_+_var(--orca-nav-width))] h-[calc(100dvh_-_var(--chrome-top,var(--page-header-height)))] w-[calc(100%_-_var(--nav-current,0px)_-_var(--orca-nav-width))]";

const EXPANDED_GEOMETRY =
  "top-[var(--chrome-top,var(--page-header-height))] left-(--nav-current,0px) h-[calc(100dvh_-_var(--chrome-top,var(--page-header-height)))] w-[calc(100%_-_var(--nav-current,0px))]";

interface SidePanelProps {
  placement: "overlay" | "inline";
  open: boolean;
  onClose: () => void;
  title: string;
  handleLabel: string;
  storageKey: string;
  expanded: boolean;
  docked?: boolean;
  sheet?: boolean;
  main?: ReactNode;
  panel: ReactNode;
}

export function SidePanel({
  placement,
  open,
  onClose,
  title,
  handleLabel,
  storageKey,
  expanded,
  docked = false,
  sheet = false,
  main,
  panel,
}: SidePanelProps) {
  const width = useSidePanelWidth(storageKey);
  const { asideRef, isDragging, cancelDrag } = width;
  const coarsePointer = useMediaQuery("(pointer: coarse)");

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const action = sidePanelEscapeAction({
        key: event.key,
        defaultPrevented: event.defaultPrevented,
        dragging: isDragging(),
        docked,
        coveredByOverlay:
          placement === "inline" &&
          document.querySelector(OPEN_OVERLAY_SELECTOR) !== null,
      });
      if (action === "cancel-drag") {
        event.preventDefault();
        cancelDrag();
      } else if (action === "close") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, docked, placement, onClose, isDragging, cancelDrag]);

  const sideMode = open && !docked && !expanded && !sheet;
  const content = (
    <>
      {sideMode && (
        <ResizeHandle
          label={handleLabel}
          coarsePointer={coarsePointer}
          resizing={width.resizing}
          currentWidthPx={width.currentWidthPx}
          maxWidthPx={width.maxWidthPx}
          onPointerDown={width.onPointerDown}
          onDoubleClick={width.onDoubleClick}
          onKeyDown={width.onKeyDown}
        />
      )}
      {panel}
    </>
  );

  if (placement === "inline") {
    return (
      <div className="flex min-h-0 min-w-0 flex-1">
        <div
          className={cn(
            "min-w-0 flex-1",
            open && (expanded || sheet) && "hidden",
          )}
        >
          {main}
        </div>
        {open && (
          <aside
            aria-label={title}
            ref={asideRef}
            data-side-panel="inline"
            className={cn(
              "flex min-h-0 flex-col bg-(--surface-column)",
              sheet
                ? "fixed top-0 right-0 z-11 h-dvh w-screen max-w-screen"
                : expanded
                  ? "relative min-w-0 flex-1"
                  : "relative w-[var(--panel-live-width,var(--centre-pane-width,420px))] max-w-[85%] shrink-0 border-l border-border",
            )}
          >
            {content}
          </aside>
        )}
      </div>
    );
  }

  return (
    <>
      {!docked && !(expanded && !sheet) && (
        <div
          onClick={onClose}
          aria-hidden="true"
          className={cn(
            "fixed inset-0 z-10 bg-scrim transition-opacity",
            open
              ? "pointer-events-auto opacity-100 duration-(--motion-panel-open) ease-(--easing-enter)"
              : "pointer-events-none opacity-0 duration-(--motion-panel-close) ease-(--easing-exit)",
          )}
        />
      )}

      <aside
        aria-label={title}
        ref={asideRef}
        inert={!docked && !open}
        data-side-panel="overlay"
        data-docked={docked ? "true" : undefined}
        className={cn(
          "fixed right-0 z-11 flex flex-col bg-(--surface-column)",
          docked
            ? DOCKED_GEOMETRY
            : expanded && !sheet
              ? EXPANDED_GEOMETRY
              : "top-0 left-auto h-dvh",
          docked
            ? "max-w-screen translate-none transition-none"
            : "transition-[translate]",
          !docked &&
            (sheet
              ? "w-screen max-w-screen"
              : !expanded &&
                "w-[var(--panel-live-width,var(--panel-width))] max-w-[calc(100vw_-_var(--nav-current,0px))] border-l border-border"),
          !docked &&
            (open
              ? "translate-x-0 duration-(--motion-panel-open) ease-(--easing-enter)"
              : "translate-x-full duration-(--motion-panel-close) ease-(--easing-exit)"),
        )}
      >
        {content}
      </aside>
    </>
  );
}

interface ResizeHandleProps {
  label: string;
  coarsePointer: boolean;
  resizing: boolean;
  currentWidthPx: number | null;
  maxWidthPx: number;
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onDoubleClick: (e: MouseEvent<HTMLDivElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
}

function ResizeHandle({
  label,
  coarsePointer,
  resizing,
  currentWidthPx,
  maxWidthPx,
  onPointerDown,
  onDoubleClick,
  onKeyDown,
}: ResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={
        currentWidthPx != null ? Math.round(currentWidthPx) : undefined
      }
      aria-valuemin={PANEL_MIN_WIDTH_PX}
      aria-valuemax={Math.round(maxWidthPx)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      className={cn(
        "absolute top-0 left-0 z-3 h-full cursor-col-resize touch-none border-l-2 bg-transparent outline-none [transition:var(--resize-handle-transition)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
        coarsePointer ? "w-(--space-xl)" : "w-2",
        resizing
          ? "border-l-(--accent)"
          : "border-l-transparent hover:border-l-(--hover-resize-handle)",
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

interface SidePanelExpandToggleProps {
  expanded: boolean;
  onToggleExpand: () => void;
  expandLabel: string;
  collapseLabel: string;
  className?: string;
}

export function SidePanelExpandToggle({
  expanded,
  onToggleExpand,
  expandLabel,
  collapseLabel,
  className,
}: SidePanelExpandToggleProps) {
  return (
    <Button
      variant="ghost"
      size="icon-md"
      className={className}
      onClick={onToggleExpand}
      aria-label={expanded ? collapseLabel : expandLabel}
    >
      {expanded ? (
        <Minimize2 className="size-4" aria-hidden="true" />
      ) : (
        <Maximize2 className="size-4" aria-hidden="true" />
      )}
    </Button>
  );
}
