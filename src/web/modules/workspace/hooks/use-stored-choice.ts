import { useEffect } from "react";

/**
 * Write one Workspace choice to its storage key whenever that choice changes.
 *
 * @remarks One effect per key, as legacy OrcaView: a change writes only its own key, so another tab's newer choice for a different key is never overwritten.
 */
export function useStoredChoice(key: string, value: string): void {
  useEffect(() => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }, [key, value]);
}
