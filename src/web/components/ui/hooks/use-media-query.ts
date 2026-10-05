import { useCallback, useSyncExternalStore } from "react";

export const CAROUSEL_QUERY = "(max-width: 1023px)";
export const NARROW_QUERY = "(max-width: 767px)";

/**
 * Subscribe to a CSS media query and return whether it matches now.
 *
 * @remarks
 * The first render reads the live match, so the first paint already has the right layout.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
  );
}
