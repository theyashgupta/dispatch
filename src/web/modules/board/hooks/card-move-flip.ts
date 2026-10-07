import {
  MAX_TRACKED_CARDS,
  cardMoveFlipDelta,
  type FlipRect,
} from "@/modules/board/domain/card-move-flip";

const outgoingRects = new Map<string, FlipRect>();

const suppressedFlips = new Map<string, number>();

const RESTORE_FALLBACK_MS = 250;

const pendingRestores = new WeakMap<HTMLElement, () => void>();

/**
 * Marks `cardId` so its next imminent remount does not play a FLIP.
 *
 * @remarks
 * A pointer-drag drop commits the column move in the batch that clears the drag, so the remount
 * sees `isDragging` already `false` and the play-leg guard cannot detect the drop. Replaying the
 * travel would snap back a gesture the user already completed. Marks expire after the freshness
 * window, so a move that never commits cannot swallow a later genuine one.
 */
export function suppressCardMoveFlip(cardId: string): void {
  if (suppressedFlips.size >= MAX_TRACKED_CARDS) {
    suppressedFlips.clear();
  }
  suppressedFlips.set(cardId, performance.now());
}

/**
 * Records `node`'s current rect under `cardId` from the FLIP layout effect's unmount cleanup.
 *
 * @remarks
 * A card unmounts from the source column and remounts in the target, so a module-level map, not a
 * DOM node or context, must carry the first rect across. The whole map is cleared past
 * `MAX_TRACKED_CARDS` so deleted cards cannot leak entries, at the cost of one un-animated move.
 */
export function recordCardMoveRect(cardId: string, node: HTMLElement): void {
  if (outgoingRects.size >= MAX_TRACKED_CARDS) {
    outgoingRects.clear();
  }
  const rect = node.getBoundingClientRect();
  outgoingRects.set(cardId, {
    left: rect.left,
    top: rect.top,
    at: performance.now(),
  });
}

/**
 * Plays the invert-then-transition sequence on a freshly mounted `node`.
 *
 * @remarks
 * The reflow read of `offsetHeight` stops the browser coalescing the inverse write and the
 * transition write into one paint with nothing to animate. The node's prior `transition` is
 * restored on a transition event or the `RESTORE_FALLBACK_MS` timeout, which is the only path under
 * `prefers-reduced-motion` because no transition event fires then. A second play on the same node
 * runs the pending restore first so it captures the true original value.
 */
export function playCardMoveFlip(cardId: string, node: HTMLElement): void {
  const suppressedAt = suppressedFlips.get(cardId);
  suppressedFlips.delete(cardId);
  const prev = outgoingRects.get(cardId);
  outgoingRects.delete(cardId);

  const delta = cardMoveFlipDelta(prev, suppressedAt, performance.now(), () =>
    node.getBoundingClientRect(),
  );
  if (delta == null) return;

  pendingRestores.get(node)?.();

  const restoreTransition = node.style.transition;
  node.style.transition = "none";
  node.style.transform = `translate(${delta.dx}px, ${delta.dy}px)`;
  void node.offsetHeight;
  node.style.transition = `transform var(--motion-card-move) var(--easing-enter)`;
  node.style.transform = "";

  const restore = () => {
    pendingRestores.delete(node);
    clearTimeout(fallback);
    node.removeEventListener("transitionend", onDone);
    node.removeEventListener("transitioncancel", onDone);
    node.style.transition = restoreTransition;
  };
  const onDone = (event: TransitionEvent) => {
    if (event.target !== node || event.propertyName !== "transform") return;
    restore();
  };
  const fallback = setTimeout(restore, RESTORE_FALLBACK_MS);
  node.addEventListener("transitionend", onDone);
  node.addEventListener("transitioncancel", onDone);
  pendingRestores.set(node, restore);
}
