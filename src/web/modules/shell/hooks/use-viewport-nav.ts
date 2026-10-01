import { useEffect, useState } from "react";
import { viewportNav } from "@/modules/shell/domain/nav-open";

/**
 * Track whether the viewport is at or below the carousel breakpoint.
 *
 * @remarks The state changes only when the breakpoint is crossed, so a resize inside one band does
 * not re-render the shell.
 */
export function useViewportNav(): { carousel: boolean } {
  const [nav, setNav] = useState(() => viewportNav(window.innerWidth));
  useEffect(() => {
    const onResize = () => {
      const next = viewportNav(window.innerWidth);
      setNav((prev) => (prev.carousel === next.carousel ? prev : next));
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return nav;
}
