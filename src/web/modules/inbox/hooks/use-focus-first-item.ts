import { useEffect, useRef } from "react";

/**
 * Return a ref for a menu content that moves focus to its first item once it opens.
 *
 * @remarks Radix focuses the content itself after a pointer open, but the legacy menu always put focus on the first item. The frame delay lets Radix finish its own focus call first.
 */
export function useFocusFirstItem() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, []);
  return ref;
}
