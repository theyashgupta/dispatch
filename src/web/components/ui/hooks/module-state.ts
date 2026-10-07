import { useSyncExternalStore } from "react";

/**
 * Create a hook over one module-scoped value that two views of a module share.
 *
 * @remarks A page view and its header view render in different slots, so they cannot share React
 * state; both read this value, which lives until the page reloads.
 */
export function createModuleState<T>(initial: T): () => [T, (next: T) => void] {
  let value = initial;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const getSnapshot = () => value;
  const setValue = (next: T) => {
    if (Object.is(next, value)) return;
    value = next;
    for (const listener of listeners) listener();
  };
  function useModuleState(): [T, (next: T) => void] {
    return [useSyncExternalStore(subscribe, getSnapshot), setValue];
  }
  return useModuleState;
}
