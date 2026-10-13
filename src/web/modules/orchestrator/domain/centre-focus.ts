import type { CentreGraph } from "./centre-graph.js";

export const CENTRE_FOCUS_ID = "centre";

type FocusKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

const FOCUS_KEYS: readonly string[] = ["ArrowDown", "ArrowUp", "Home", "End"];

export function isFocusKey(key: string): key is FocusKey {
  return FOCUS_KEYS.includes(key);
}

/**
 * The focus order of the canvas: the centre node, then the visible branches band by band.
 *
 * @remarks Branches follow the band order, not the slot order, so the arrow keys walk the tiles as they sit on screen.
 */
export function focusOrder(graph: CentreGraph): string[] {
  return [
    CENTRE_FOCUS_ID,
    ...graph.bands.flatMap((band) => band.branches.map((b) => b.id)),
  ];
}

/**
 * The id that takes focus after a key press on `current`.
 *
 * @remarks An id that is not in the order, for example a tile that just left the canvas, sends focus to the centre node.
 */
export function nextFocus(
  order: readonly string[],
  current: string,
  key: FocusKey,
): string {
  const first = order[0] ?? CENTRE_FOCUS_ID;
  const last = order[order.length - 1] ?? first;
  const index = order.indexOf(current);
  if (index === -1) return first;
  switch (key) {
    case "Home":
      return first;
    case "End":
      return last;
    case "ArrowUp":
      return order[Math.max(index - 1, 0)];
    case "ArrowDown":
      return order[Math.min(index + 1, order.length - 1)];
  }
}
