import { useSyncExternalStore } from "react";
import type { Column as ColumnId } from "../../shared/types.js";

const STORAGE_KEY = "dsp.board.columnWidths";

export type ColumnWidthsMap = Partial<Record<ColumnId, number>>;

function loadWidths(): ColumnWidthsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object") return {};
    const result: ColumnWidthsMap = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof value === "number" && Number.isFinite(value)) {
        result[key as ColumnId] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

let widths: ColumnWidthsMap = loadWidths();
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): ColumnWidthsMap {
  return widths;
}

export function setColumnWidth(column: ColumnId, px: number): void {
  widths = { ...widths, [column]: px };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {}
  for (const cb of listeners) cb();
}

export function clearColumnWidth(column: ColumnId): void {
  const next = { ...widths };
  delete next[column];
  widths = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {}
  for (const cb of listeners) cb();
}

/** Subscribe to the persisted per-column width map; re-renders the caller whenever a column resizes or resets. */
export function useColumnWidths(): ColumnWidthsMap {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
