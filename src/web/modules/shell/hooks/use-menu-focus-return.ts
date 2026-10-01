import { useCallback, useEffect, useRef } from "react";
import { SHELL_IDS } from "@/modules/shell/domain/shell-ids";

/**
 * Return focus to the top bar menu button when the phone navigation sheet closes.
 *
 * @remarks Radix returns focus only to a trigger element, and the menu button is not one. Call the
 * returned function before a close that opens an overlay, so the overlay keeps its own focus.
 */
export function useMenuFocusReturn(openMobile: boolean): () => void {
  const wasOpen = useRef(false);
  const skip = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !openMobile && !skip.current) {
      requestAnimationFrame(() =>
        document.getElementById(SHELL_IDS.navMenu)?.focus(),
      );
    }
    wasOpen.current = openMobile;
    skip.current = false;
  }, [openMobile]);
  return useCallback(() => {
    skip.current = true;
  }, []);
}
