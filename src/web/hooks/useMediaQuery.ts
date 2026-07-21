import { useEffect, useState } from "react";

/**
 * The single narrow-width breakpoint shared by the board carousel and the detail-panel
 * takeover.
 *
 * @remarks
 * Both surfaces must switch on the exact same pixel: a divergence produces a board that
 * is a carousel while the panel is still docked (or the reverse), which is precisely the
 * broken intermediate state the responsive layout exists to avoid.
 */
export const CAROUSEL_QUERY = "(max-width: 1023px)";

/**
 * Subscribe to a CSS media query and return its current match state.
 *
 * @remarks
 * The single sanctioned place a layout decision escapes a CSS token: the board
 * carousel toggle at `max-width: 1023px` cannot be expressed as a design token,
 * so it reads the live match here. One stable `matchMedia` subscription per
 * query — the listener is attached inside an effect keyed on `query`, never
 * re-created on every render (avoids the resubscribe-per-render perf trap).
 * State initializes lazily from the live match (no SSR — `window` always
 * exists) so the first paint already has the correct layout.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
