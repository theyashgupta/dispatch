import { useCallback, useEffect, useRef, useState } from "react";

const EXIT_MS = 150;

/**
 * Own the open state of a dialog its caller mounts, and report the close once the exit animation ended.
 *
 * @remarks
 * The caller unmounts the dialog when `onClose` runs, so the call waits for the Radix exit animation (the panel-close motion token, 150 ms). With `closeOnOverlayClick`, a click on the overlay closes too, because Radix AlertDialog ignores outside clicks.
 */
export function useDialogClose(
  onClose: () => void,
  options: { closeOnOverlayClick?: boolean } = {},
): {
  open: boolean;
  requestClose: () => void;
  onOpenChange: (open: boolean) => void;
} {
  const { closeOnOverlayClick = false } = options;
  const [open, setOpen] = useState(true);
  const closingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setOpen(false);
    timerRef.current = setTimeout(() => onCloseRef.current(), EXIT_MS);
  }, []);

  useEffect(() => {
    if (!closeOnOverlayClick) return;
    const onClick = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.matches('[data-slot="alert-dialog-overlay"]')
      ) {
        requestClose();
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [closeOnOverlayClick, requestClose]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next) requestClose();
    },
    [requestClose],
  );

  return { open, requestClose, onOpenChange };
}
