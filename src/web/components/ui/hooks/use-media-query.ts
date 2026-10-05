import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query and return its current match state.
 *
 * @remarks Some layout choices, such as the icon-only row buttons below 1024 px, change markup and cannot be done in CSS alone. The state starts from the live match, so the first paint already has the right layout.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
  );
}
