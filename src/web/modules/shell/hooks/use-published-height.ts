import { useEffect } from "react";

/**
 * Publish an element's measured height as a CSS variable on a target element.
 *
 * @remarks The chrome stack publishes `--chrome-top` on the shell root for the docked detail panel, which falls back to `--page-header-height` until the first measurement. The bottom bar publishes `--bottom-bar-height` on the document root because toasts and sheets portal to the body.
 */
export function usePublishedHeight(
  el: HTMLElement | null,
  target: HTMLElement | null,
  name: string,
): void {
  useEffect(() => {
    if (el == null || target == null) return;
    const observer = new ResizeObserver(() =>
      target.style.setProperty(name, `${el.offsetHeight}px`),
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      target.style.removeProperty(name);
    };
  }, [el, target, name]);
}
