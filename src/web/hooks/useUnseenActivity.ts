import { useSyncExternalStore } from "react";
import type { LastOpenedMap } from "../lib/unseen-activity.js";

export { isUnseen, type LastOpenedMap } from "../lib/unseen-activity.js";

const STORAGE_KEY = "dsp.unseen.lastOpened";

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

/** Subscribe to the lastOpened map; re-renders the caller whenever any card is stamped. */
export function useLastOpened(): LastOpenedMap {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
