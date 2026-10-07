import { CAROUSEL_MAX_WIDTH } from "../../../../shared/media-queries.js";

export type NavPreference = "expanded" | "collapsed";

/**
 * Classify a viewport width against the carousel breakpoint the shell reacts to.
 *
 * @remarks The width comes from `src/shared/media-queries.ts`, the same source as the `CAROUSEL_QUERY` that
 * the board carousel and the detail panel switch on.
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
