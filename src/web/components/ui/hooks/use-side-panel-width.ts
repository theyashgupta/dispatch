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
} from "../../../../shared/side-panel-width.js";

const WIDTH_VAR = "--panel-live-width";
const SERVER_VIEWPORT_PX = 1280;

interface WidthStore {
  width: number | null;
  listeners: Set<() => void>;
}

const stores = new Map<string, WidthStore>();

function loadWidth(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function notify(store: WidthStore): void {
  for (const cb of store.listeners) cb();
}

function storeFor(key: string): WidthStore {
  const found = stores.get(key);
  if (found) return found;
  const store: WidthStore = { width: loadWidth(key), listeners: new Set() };
  stores.set(key, store);
  window.addEventListener("storage", (e) => {
    if (e.key !== key) return;
    store.width = loadWidth(key);
    notify(store);
  });
  return store;
}

function setStoredWidth(key: string, px: number | null): void {
  const store = storeFor(key);
  store.width = px;
  try {
    if (px == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(px));
  } catch {}
  notify(store);
}

/**
 * Own a side panel width: the persisted store for one storage key, the handle's drag, keys and
 * double click, and the live width the `aside` reads as a CSS variable.
 *
 * @remarks
 * The drag writes `--panel-live-width` on the `aside` directly, so a pointermove never re-renders.
 * A drag appends a full-viewport overlay to the body so `pointerup` never lands inside the terminal
 * iframe; one idempotent teardown removes it on `pointerup`, `pointercancel`, Escape and unmount.
 */
export function useSidePanelWidth(storageKey: string) {
  const subscribe = useCallback(
    (cb: () => void) => {
      const { listeners } = storeFor(storageKey);
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    [storageKey],
  );
  const persistedWidth = useSyncExternalStore(
    subscribe,
    () => storeFor(storageKey).width,
    () => null,
  );
  const nodeRef = useRef<HTMLElement | null>(null);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const asideRef = useCallback((element: HTMLElement | null) => {
    nodeRef.current = element;
    setNode(element);
  }, []);
  const cleanupDragRef = useRef<(() => void) | null>(null);
  const [resizing, setResizing] = useState(false);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const [, setViewportWidth] = useState<number>(viewportWidthPx);

  useEffect(() => {
    return () => cleanupDragRef.current?.();
  }, []);

  useEffect(() => {
    if (resizing) return;
    if (node == null) return;
    const observer = new ResizeObserver(() => {
      setMeasuredWidth(node.getBoundingClientRect().width);
      setViewportWidth(window.innerWidth);
    });
    observer.observe(node);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, [resizing, node]);

  useLayoutEffect(() => {
    if (node == null) return;
    if (persistedWidth != null) {
      node.style.setProperty(WIDTH_VAR, persistedWidthCss(persistedWidth));
    } else {
      node.style.removeProperty(WIDTH_VAR);
    }
  }, [persistedWidth, node]);

  const viewport = viewportWidthPx();
  const maxWidthPx = viewport * PANEL_MAX_WIDTH_RATIO;
  const rawWidthPx = measuredWidth ?? persistedWidth;
  const currentWidthPx =
    rawWidthPx != null ? clampPanelWidth(rawWidthPx, viewport) : null;

  const isDragging = useCallback(() => cleanupDragRef.current != null, []);
  const cancelDrag = useCallback(() => cleanupDragRef.current?.(), []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const node = nodeRef.current;
    if (node == null) return;
    setStoredWidth(
      storageKey,
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
    const found = nodeRef.current;
    if (found == null) return;
    const node: HTMLElement = found;
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = node.getBoundingClientRect().width;
    const preDragWidth = node.style.getPropertyValue(WIDTH_VAR);
    const dragViewportWidth = window.innerWidth;
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
        dragViewportWidth,
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
      const finalWidth = clampPanelWidth(startWidth + delta, dragViewportWidth);
      node.style.setProperty(WIDTH_VAR, persistedWidthCss(finalWidth));
      setStoredWidth(storageKey, finalWidth);
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
    const node = nodeRef.current;
    if (node != null) {
      node.style.removeProperty(WIDTH_VAR);
      setMeasuredWidth(node.getBoundingClientRect().width);
    }
    setStoredWidth(storageKey, null);
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

/**
 * The viewport width in pixels, or a fixed desktop width where no window exists.
 *
 * @remarks Server rendering has no window, and a static render test reads the same fallback.
 */
function viewportWidthPx(): number {
  return typeof window === "undefined" ? SERVER_VIEWPORT_PX : window.innerWidth;
}
