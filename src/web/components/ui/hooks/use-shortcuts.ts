import { useEffect, useLayoutEffect, useRef } from "react";
import {
  resolveShortcut,
  type ShortcutBinding,
} from "../../../../shared/shortcuts.js";

const EDITABLE_SELECTOR =
  '[role="combobox"], [role="listbox"], [contenteditable="true"]';

const MODAL_SELECTOR =
  '[aria-modal="true"], [data-slot="dialog-content"], [data-slot="alert-dialog-content"]';

/**
 * Fire key bindings from one window listener, gated by the pure resolver.
 *
 * @remarks The bindings live in a ref, written in a layout effect so a press right after a render sees the new rows. A modal is any legacy Modal or Radix Dialog or AlertDialog found in the DOM, so a dialog in its exit animation still blocks keys; a Sheet does not count. `scopeId` names the element focus must sit in, body included.
 */
export function useShortcuts(
  bindings: readonly ShortcutBinding[],
  options: { menuOpen: boolean; scopeId: string },
): void {
  const { menuOpen, scopeId } = options;
  const bindingsRef = useRef(bindings);
  useLayoutEffect(() => {
    bindingsRef.current = bindings;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        !event.metaKey &&
        !event.ctrlKey &&
        target?.closest(EDITABLE_SELECTOR) != null
      ) {
        return;
      }
      const scope = document.getElementById(scopeId);
      const inScope =
        target == null ||
        target === document.body ||
        (scope?.contains(target) ?? false);
      const binding = resolveShortcut(
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          target,
        },
        bindingsRef.current,
        {
          modalOpen: document.querySelector(MODAL_SELECTOR) != null,
          menuOpen,
          inScope,
        },
      );
      if (binding == null) return;
      event.preventDefault();
      binding.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, scopeId]);
}
