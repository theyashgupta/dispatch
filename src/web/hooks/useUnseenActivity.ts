import { useSyncExternalStore } from "react";

const STORAGE_KEY = "ak.unseen.lastOpened";

export type LastOpenedMap = Record<string, string>;

function loadMap(): LastOpenedMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed != null && typeof parsed === "object"
      ? (parsed as LastOpenedMap)
      : {};
  } catch {
    return {};
  }
}

let lastOpened: LastOpenedMap = loadMap();
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): LastOpenedMap {
  return lastOpened;
}

/**
 * Record that a card's panel was just opened or closed — stamps `lastOpened[id] = now`, persists,
 * and re-renders every consumer (so the card's dot clears immediately). Called on BOTH open and
 * close: the close-stamp masks any `outputChangedAt` accrued while the panel was open (including
 * pane geometry-rewrap noise), which is why no backend geometry guard is needed for the dot.
 */
export function stampLastOpened(id: string): void {
  lastOpened = { ...lastOpened, [id]: new Date().toISOString() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lastOpened));
  } catch {}
  for (const cb of listeners) cb();
}

/**
 * Is this card's agent output unseen? True when the backend stamped `outputChangedAt` more recently
 * than the viewer last opened the card's panel. A missing `lastOpenedIso` (never opened) → unseen
 * as soon as `outputChangedAt` is set; a missing `outputChangedAt` (no divergence yet) → never
 * unseen. ISO-8601 timestamps compare correctly as strings.
 */
export function isUnseen(
  outputChangedAt: string | undefined,
  lastOpenedIso: string | undefined,
): boolean {
  if (outputChangedAt == null) return false;
  if (lastOpenedIso == null) return true;
  return outputChangedAt > lastOpenedIso;
}

/** Subscribe to the lastOpened map; re-renders the caller whenever any card is stamped. */
export function useLastOpened(): LastOpenedMap {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
