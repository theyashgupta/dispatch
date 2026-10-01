import { useState } from "react";

/**
 * Return a close handler that puts focus back on the element focused when the dialog mounted.
 *
 * @remarks The App closes its overlays while the Radix dialog is still mounted, so its focus call
 * loses to the focus trap. Radix then drops focus on the body because a dialog opened by a shortcut
 * has no trigger.
 */
export function useReturnFocus(): (event: Event) => void {
  const [opener] = useState(() => document.activeElement);
  return (event) => {
    event.preventDefault();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  };
}
