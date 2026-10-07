import { useEffect, type RefObject } from "react";

const TABBABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Send a Tab press that starts outside a dialog to its first tabbable element, and Shift+Tab to its last.
 *
 * @remarks
 * The Sync to Linear dialog keeps focus on its trigger when it opens, as the legacy Modal did, so Radix never sees the first Tab. Once focus is inside, Radix traps the later presses.
 */
export function useTabIntoDialog(
  contentRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const dialog = contentRef.current;
      if (dialog == null || dialog.contains(document.activeElement)) return;
      const tabbable = Array.from(
        dialog.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR),
      ).filter(
        (el) =>
          !el.hidden &&
          el.closest("[inert]") == null &&
          el.getClientRects().length > 0,
      );
      const target = event.shiftKey ? tabbable.at(-1) : tabbable[0];
      if (target == null) return;
      event.preventDefault();
      target.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contentRef]);
}
