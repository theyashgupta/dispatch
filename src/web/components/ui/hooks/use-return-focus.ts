import { useState } from "react";

/**
 * Return focus to the element that opened a dialog once the dialog's focus scope lets go.
 *
 * @remarks
 * Radix returns focus only to a `DialogTrigger`, and these dialogs open from state, so the opener is
 * read while the dialog first renders open, before its content takes focus. Pass the handler to the
 * content's `onCloseAutoFocus`.
 */
export function useReturnFocus(open: boolean): (event: Event) => void {
  const [wasOpen, setWasOpen] = useState(false);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setOpener(
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      );
    }
  }
  return (event) => {
    event.preventDefault();
    opener?.focus();
  };
}
