import { useEffect } from "react";

/**
 * Publish the height of the chrome stack (top bar, banner, page header) as `--chrome-top` on the shell root.
 *
 * @remarks The docked detail panel anchors below the stack through this variable. The height is
 * measured because the banner adds a variable number of rows. The variable stays unset until the
 * first measurement, so the panel falls back to `--page-header-height`.
 */
export function useChromeTop(
  chrome: HTMLElement | null,
  root: HTMLElement | null,
): void {
  useEffect(() => {
    if (chrome == null || root == null) return;
    const observer = new ResizeObserver(() =>
      root.style.setProperty("--chrome-top", `${chrome.offsetHeight}px`),
    );
    observer.observe(chrome);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--chrome-top");
    };
  }, [chrome, root]);
}
