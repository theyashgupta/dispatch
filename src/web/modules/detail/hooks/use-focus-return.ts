import { useLayoutEffect, useRef } from "react";

/**
 * Focus the element that held focus when the panel opened, once the panel closes.
 *
 * @remarks
 * The legacy panel left focus on the body after every close; this returns it to the opener when the
 * opener is still in the document. The panel adds no focus trap.
 */
export function useFocusReturn(open: boolean): void {
  const wasOpenRef = useRef(open);
  const openerRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (open === wasOpenRef.current) return;
    wasOpenRef.current = open;
    if (open) {
      const active = document.activeElement;
      openerRef.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
      return;
    }
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, [open]);
}
