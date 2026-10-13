import { useCallback, useRef, type KeyboardEvent } from "react";
import { isFocusKey, nextFocus } from "../domain/centre-focus.js";

/**
 * Keep the focusable elements of the canvas by id and move focus between them with the arrow keys, Home and End.
 *
 * @remarks Enter is left to the tile button, which opens the card on its own. A key press from a field inside a tile never reaches the handler, because only the tile button and the node carry it.
 */
export function useTileFocus(order: readonly string[]) {
  const elements = useRef(new Map<string, HTMLElement>());

  const register = useCallback(
    (id: string) => (element: HTMLElement | null) => {
      if (element === null) elements.current.delete(id);
      else elements.current.set(id, element);
    },
    [],
  );

  const onKeyDown = useCallback(
    (id: string) => (event: KeyboardEvent<HTMLElement>) => {
      if (!isFocusKey(event.key)) return;
      event.preventDefault();
      elements.current.get(nextFocus(order, id, event.key))?.focus();
    },
    [order],
  );

  return { register, onKeyDown };
}
