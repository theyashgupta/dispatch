import { useEffect, type RefObject } from "react";

/**
 * Keep a scroll region at its end when its box changes size while the view is at the end.
 *
 * @remarks The start-failed alert can mount above the pane in the same frame as the scroll to the end, before Chrome scroll anchoring has an anchor, and the view then stays short of the end.
 */
export function usePinnedToEnd(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const region = ref.current;
    if (region === null) return;
    let previousHeight = region.clientHeight;
    const observer = new ResizeObserver(() => {
      if (region.scrollHeight - region.scrollTop - previousHeight <= 1)
        region.scrollTop = region.scrollHeight;
      previousHeight = region.clientHeight;
    });
    observer.observe(region);
    return () => observer.disconnect();
  }, [ref]);
}
