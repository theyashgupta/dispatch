import { useEffect, useLayoutEffect, useRef } from "react";
import { resolveShortcut, type ShortcutBinding } from "../lib/shortcuts.js";
import { modalDepth } from "../primitives/Modal.js";

/**
 * Fire key bindings from one window listener, gated by the pure resolver.
 *
 * @remarks The bindings live in a ref (written in a layout effect so a press right after a render
 * sees the new rows) and the listener is attached once per menu change; the pure resolver decides
 * whether a press counts, and `scopeId` names the element focus must sit in, body included.
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
        { modalOpen: modalDepth() > 0, menuOpen, inScope },
      );
      if (binding == null) return;
      event.preventDefault();
      binding.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, scopeId]);
}
