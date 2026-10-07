import { useSyncExternalStore } from "react";

/**
 * Read one slice of an external store and re-render when that slice changes.
 *
 * @remarks The selector must return one stored field or a primitive. A selector that builds a new
 * object or array returns a new value on every read, and `useSyncExternalStore` then loops.
 */
export function useAppStore<S, T>(
  store: { subscribe: (listener: () => void) => () => void; getState: () => S },
  select: (state: S) => T,
): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}
