import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import {
  PANEL_MAX_WIDTH_RATIO,
  clampPanelWidth,
  isTapGesture,
  keyboardStepWidth,
  persistedWidthCss,
  startsResizeDrag,
} from "@/modules/detail/domain/panel-width";

const STORAGE_KEY = "dsp.panel.width";
const WIDTH_VAR = "--panel-live-width";

function loadWidth(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

let width: number | null = loadWidth();
const listeners = new Set<() => void>();

window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY) {
    width = loadWidth();
    for (const cb of listeners) cb();
  }
});

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): number | null {
  return width;
}

function setPanelWidth(px: number): void {
  width = px;
  try {
    localStorage.setItem(STORAGE_KEY, String(px));
  } catch {}
  for (const cb of listeners) cb();
}

function clearPanelWidth(): void {
  width = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  for (const cb of listeners) cb();
}

/**
 * Own the overlay panel width: the persisted store, the handle's drag, keys and double click, and
 * the live width the `aside` reads as a CSS variable.
 *
 * @remarks
 * The width reaches the `aside` through `--panel-live-width`, written on the element through the
 * ref, because the module bans the JSX `style` prop. A drag appends a full-viewport overlay to the
 * body so `pointerup` never lands inside the terminal iframe; one idempotent teardown removes it on
 * `pointerup`, `pointercancel`, Escape and unmount.
 */
export function usePanelResize() {
  const persistedWidth = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
  const asideRef = useRef<HTMLElement | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);
  const [resizing, setResizing] = useState(false);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const [, setViewportWidth] = useState<number>(() => window.innerWidth);

  useEffect(() => {
    return () => cleanupDragRef.current?.();
  }, []);

  useEffect(() => {
    if (resizing) return;
    const node = asideRef.current;
    if (node == null) return;
    const observer = new ResizeObserver(() => {
      setMeasuredWidth(node.getBoundingClientRect().width);
      setViewportWidth(window.innerWidth);
    });
    observer.observe(node);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, [resizing]);

  useLayoutEffect(() => {
    const node = asideRef.current;
    if (node == null) return;
    if (persistedWidth != null) {
      node.style.setProperty(WIDTH_VAR, persistedWidthCss(persistedWidth));
    } else {
      node.style.removeProperty(WIDTH_VAR);
    }
  }, [persistedWidth]);

  const maxWidthPx = window.innerWidth * PANEL_MAX_WIDTH_RATIO;
  const rawWidthPx = persistedWidth ?? measuredWidth;
  const currentWidthPx =
    rawWidthPx != null ? clampPanelWidth(rawWidthPx, window.innerWidth) : null;

  const isDragging = useCallback(() => cleanupDragRef.current != null, []);
  const cancelDrag = useCallback(() => cleanupDragRef.current?.(), []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const node = asideRef.current;
    if (node == null) return;
    setPanelWidth(
      keyboardStepWidth(
        e.key,
        currentWidthPx ?? node.getBoundingClientRect().width,
        window.innerWidth,
      ),
    );
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!startsResizeDrag(e.button)) return;
    if (cleanupDragRef.current != null) return;
    e.stopPropagation();
    const found = asideRef.current;
    if (found == null) return;
    const node: HTMLElement = found;
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = node.getBoundingClientRect().width;
    const preDragWidth = node.style.getPropertyValue(WIDTH_VAR);
    const viewportWidth = window.innerWidth;
    const pointerType = e.pointerType;
    setResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const overlay = document.createElement("div");
    overlay.className =
      "fixed inset-0 z-[2147483647] cursor-col-resize touch-none";
    document.body.appendChild(overlay);

    function restoreWidth() {
      if (preDragWidth === "") node.style.removeProperty(WIDTH_VAR);
      else node.style.setProperty(WIDTH_VAR, preDragWidth);
    }

    function teardown() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      overlay.remove();
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      cleanupDragRef.current = null;
    }

    function handlePointerMove(ev: globalThis.PointerEvent) {
      const next = clampPanelWidth(
        startWidth + (startX - ev.clientX),
        viewportWidth,
      );
      node.style.setProperty(WIDTH_VAR, `${next}px`);
    }

    function handlePointerUp(ev: globalThis.PointerEvent) {
      teardown();
      setResizing(false);
      const delta = startX - ev.clientX;
      if (isTapGesture(delta, pointerType)) {
        restoreWidth();
        return;
      }
      const finalWidth = clampPanelWidth(startWidth + delta, viewportWidth);
      node.style.setProperty(WIDTH_VAR, persistedWidthCss(finalWidth));
      setPanelWidth(finalWidth);
    }

    function handlePointerCancel() {
      teardown();
      setResizing(false);
      restoreWidth();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    cleanupDragRef.current = handlePointerCancel;
  }

  function onDoubleClick(e: MouseEvent<HTMLDivElement>) {
    e.stopPropagation();
    const node = asideRef.current;
    if (node != null) {
      node.style.removeProperty(WIDTH_VAR);
      setMeasuredWidth(node.getBoundingClientRect().width);
    }
    clearPanelWidth();
  }

  return {
    asideRef,
    currentWidthPx,
    maxWidthPx,
    resizing,
    isDragging,
    cancelDrag,
    onKeyDown,
    onPointerDown,
    onDoubleClick,
  };
}
