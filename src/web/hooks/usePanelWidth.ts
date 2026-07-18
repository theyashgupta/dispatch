import { useSyncExternalStore } from "react";

const STORAGE_KEY = "dsp.panel.width";

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

export function setPanelWidth(px: number): void {
  width = px;
  try {
    localStorage.setItem(STORAGE_KEY, String(px));
  } catch {}
  for (const cb of listeners) cb();
}

export function clearPanelWidth(): void {
  width = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  for (const cb of listeners) cb();
}

/**
 * Subscribe to the persisted detail-panel width; re-renders the caller whenever the panel
 * resizes or resets.
 *
 * @remarks
 * Pointer-only by design: this is a single-user, pointer-primary local tool, the resize handle
 * mirrors the pre-existing Column.tsx precedent (also pointer-only, no keyboard alternative),
 * and RESIZE-01's success criteria only requires drag-to-resize.
 */
export function usePanelWidth(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
