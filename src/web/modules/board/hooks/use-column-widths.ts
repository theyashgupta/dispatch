import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Column as ColumnId } from "../../../../shared/types.js";
import {
  COLUMN_WIDTH_MIN,
  clampColumnWidth,
  isWidthDrag,
  parseColumnWidths,
  type ColumnWidthsMap,
} from "@/modules/board/domain/column-widths";

const STORAGE_KEY = "dsp.board.columnWidths";

function loadWidths(): ColumnWidthsMap {
  try {
    return parseColumnWidths(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

let widths: ColumnWidthsMap = loadWidths();
const listeners = new Set<() => void>();

window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY) {
    widths = loadWidths();
    for (const cb of listeners) cb();
  }
});

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): ColumnWidthsMap {
  return widths;
}

/** Replace the saved width map, persist it and notify every subscriber. */
function commit(next: ColumnWidthsMap): void {
  widths = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {}
  for (const cb of listeners) cb();
}

/** Save a column width and notify every subscriber. */
function setColumnWidth(column: ColumnId, px: number): void {
  commit({ ...widths, [column]: px });
}

/** Forget a column width so the column returns to flexible sizing. */
function clearColumnWidth(column: ColumnId): void {
  const next = { ...widths };
  delete next[column];
  commit(next);
}

/**
 * Own the resize state of one board column: its measured width, the saved width and the drag.
 *
 * @remarks
 * The width reaches the column through the `--column-width` custom property written on the node,
 * so no inline style prop is needed. A drag that moved at most the click threshold restores the
 * width the column had before it.
 */
export function useColumnResize(column: ColumnId, disabled: boolean) {
  const persistedWidth = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  )[column];
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);
  const [resizing, setResizing] = useState(false);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);

  const columnRef = useCallback((node: HTMLDivElement | null) => {
    nodeRef.current = node;
  }, []);

  useEffect(() => {
    return () => cleanupDragRef.current?.();
  }, []);

  useEffect(() => {
    const node = nodeRef.current;
    if (node == null) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width != null) setMeasuredWidth(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (node == null) return;
    if (persistedWidth == null) {
      node.style.removeProperty("--column-width");
    } else {
      node.style.setProperty(
        "--column-width",
        `${clampColumnWidth(persistedWidth)}px`,
      );
    }
  }, [persistedWidth]);

  const width = clampColumnWidth(
    persistedWidth ?? measuredWidth ?? COLUMN_WIDTH_MIN,
  );

  function onResizeStart(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    const node = nodeRef.current;
    if (node == null) return;
    const startX = event.clientX;
    const startWidth = node.getBoundingClientRect().width;
    node.style.setProperty("--column-width", `${startWidth}px`);
    setResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function handlePointerMove(ev: PointerEvent) {
      const next = clampColumnWidth(startWidth + (ev.clientX - startX));
      node!.style.setProperty("--column-width", `${next}px`);
    }

    function handlePointerUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      cleanupDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setResizing(false);
      const delta = ev.clientX - startX;
      if (isWidthDrag(delta)) {
        setColumnWidth(column, clampColumnWidth(startWidth + delta));
      } else if (persistedWidth != null) {
        node!.style.setProperty(
          "--column-width",
          `${clampColumnWidth(persistedWidth)}px`,
        );
      } else {
        node!.style.removeProperty("--column-width");
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    cleanupDragRef.current = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }

  function onResizeKey(next: number) {
    nodeRef.current?.style.setProperty("--column-width", `${next}px`);
    setColumnWidth(column, next);
  }

  function onReset() {
    nodeRef.current?.style.removeProperty("--column-width");
    clearColumnWidth(column);
  }

  return {
    columnRef,
    persistedWidth,
    width,
    resizing,
    onResizeStart,
    onResizeKey,
    onReset,
  };
}
