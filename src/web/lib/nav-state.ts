export type NavMode = "expanded" | "collapsed" | "topbar";

/**
 * Decides how the sidebar renders from the remembered preference and the two breakpoints.
 * @remarks Below 768px the sidebar leaves the layout for a top bar; at or below 1023px it is
 * forced collapsed so the board carousel keeps its width; otherwise the stored choice wins.
 */
export function effectiveNavState(
  stored: "expanded" | "collapsed",
  carousel: boolean,
  narrow: boolean,
): NavMode {
  if (narrow) return "topbar";
  if (carousel) return "collapsed";
  return stored;
}
