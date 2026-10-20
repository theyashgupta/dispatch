import { useEffect } from "react";

/**
 * Publish the bottom bar height as `--bottom-bar-height` on the document root.
 *
 * @remarks The variable lives on the document root because toasts and sheets portal to the body and do not inherit from the shell root.
 */
export function useBottomBarHeight(bar: HTMLElement | null): void {
  useEffect(() => {
    if (bar == null) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() =>
      root.style.setProperty("--bottom-bar-height", `${bar.offsetHeight}px`),
    );
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--bottom-bar-height");
    };
  }, [bar]);
}
