export type NavPreference = "expanded" | "collapsed";

export const CAROUSEL_MAX_WIDTH = 1023;

/**
 * Classify a viewport width against the carousel breakpoint the shell reacts to.
 *
 * @remarks The carousel breakpoint matches `CAROUSEL_QUERY` in `hooks/useMediaQuery.ts`, which the
 * board carousel and the detail panel also switch on.
 */
export function viewportNav(width: number): { carousel: boolean } {
  return { carousel: width <= CAROUSEL_MAX_WIDTH };
}

/**
 * Decide whether the desktop sidebar is open from the stored choice and the carousel breakpoint.
 *
 * @remarks At or below the carousel breakpoint the sidebar is forced closed so the board keeps its
 * width; above it the stored choice wins.
 */
export function sidebarOpen(stored: NavPreference, carousel: boolean): boolean {
  return carousel ? false : stored === "expanded";
}

/**
 * Read a stored `dsp.nav` value, treating anything but the exact string "collapsed" as expanded.
 */
export function parseNavPreference(raw: string | null): NavPreference {
  return raw === "collapsed" ? "collapsed" : "expanded";
}
