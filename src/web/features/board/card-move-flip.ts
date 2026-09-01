interface Rect {
  left: number;
  top: number;
}

/**
 * Bound on the number of tracked outgoing rects. A deleted card would
 * otherwise leave its entry forever. Card ids are ordinarily bounded by the
 * board's own live card set (tens, not thousands); clearing the whole map
 * past this size costs one un-animated move on whichever card mounts next,
 * strictly cheaper than an unbounded per-process leak.
 */
const MAX_TRACKED_CARDS = 300;

/**
 * FLIP (First, Last, Invert, Play) rect store for a card's cross-column move.
 *
 * @remarks
 * `Board.tsx` renders one `Column` per column, each mapping its own cards
 * (`Column.tsx`'s `renderCard`), so a card whose `column` changes UNMOUNTS
 * from the source column's subtree and MOUNTS a different `<Card>` element
 * in the target column's subtree: there is no persistent DOM node a plain
 * CSS `transition` could interpolate between the two positions. This map is
 * module-level, not a React context: a context value dies with its
 * provider's subtree, but this map must outlive the unmounting component by
 * construction, and this app uses `createContext` nowhere today. The
 * "First" rect is read at UNMOUNT rather than on every commit, since React
 * runs layout-effect cleanups during the commit's mutation phase, before the
 * node detaches, so the read sees the last painted position, at the cost of
 * one `getBoundingClientRect()` per actual unmount, never per commit (this
 * board was hardened for scale in Phase 82). The motion itself is written as
 * a plain CSS `transition` from a layout effect, never the Web Animations
 * API or a per-frame JS scheduling loop, so the `prefers-reduced-motion`
 * kill switch in `tokens.css` reaches it.
 */
const outgoingRects = new Map<string, Rect>();

/**
 * Freshness window for a suppression mark (and, symmetrically, a stored
 * rect): a drop-committed move records and plays inside one React commit,
 * so anything older than this is not part of the current move.
 */
const FLIP_STALE_MS = 100;

const suppressedFlips = new Map<string, number>();

/**
 * Marks `cardId` so its next imminent remount does not play a FLIP.
 *
 * @remarks
 * A pointer-drag drop commits the column move in the same batch that clears
 * the drag, so the card remounts with `isDragging` already `false` and the
 * play-leg guard cannot see the drop. The user already moved the card by
 * hand; replaying the travel would snap it back and re-animate a completed
 * gesture. `Board.tsx` calls this from `handleDragEnd` for the dropped ids.
 * Marks expire after {@link FLIP_STALE_MS}, so a move that never commits
 * (same column, refused target) cannot swallow a later genuine move.
 */
export function suppressCardMoveFlip(cardId: string): void {
  if (suppressedFlips.size >= MAX_TRACKED_CARDS) {
    suppressedFlips.clear();
  }
  suppressedFlips.set(cardId, performance.now());
}

/**
 * Records `node`'s current rect under `cardId`, called from the FLIP layout
 * effect's cleanup on unmount.
 */
export function recordCardMoveRect(cardId: string, node: HTMLElement): void {
  if (outgoingRects.size >= MAX_TRACKED_CARDS) {
    outgoingRects.clear();
  }
  const rect = node.getBoundingClientRect();
  outgoingRects.set(cardId, { left: rect.left, top: rect.top });
}

/**
 * Plays the invert-then-transition sequence on a freshly mounted `node`.
 *
 * @remarks
 * No-op if no rect was stored for `cardId` (an ordinary mount, not a column
 * move) or the delta is zero on both axes. Writes an untransitioned inverse
 * `transform`, forces a reflow (reading `offsetHeight`, or the browser would
 * coalesce the inverse write and the transition-enabling write into one
 * paint and there would be nothing left to animate), then enables a
 * `transform` transition and clears the transform to identity so the
 * browser animates the rest. The node's own prior `transition` value is
 * restored once that transition ends, so a caller's own `transition` (e.g.
 * `--hover-transition`) is not permanently overwritten.
 */
export function playCardMoveFlip(cardId: string, node: HTMLElement): void {
  const suppressedAt = suppressedFlips.get(cardId);
  if (suppressedAt != null) {
    suppressedFlips.delete(cardId);
    if (performance.now() - suppressedAt <= FLIP_STALE_MS) {
      outgoingRects.delete(cardId);
      return;
    }
  }

  const prev = outgoingRects.get(cardId);
  if (prev == null) return;
  outgoingRects.delete(cardId);

  const next = node.getBoundingClientRect();
  const dx = prev.left - next.left;
  const dy = prev.top - next.top;
  if (dx === 0 && dy === 0) return;

  const restoreTransition = node.style.transition;
  node.style.transition = "none";
  node.style.transform = `translate(${dx}px, ${dy}px)`;
  void node.offsetHeight;
  node.style.transition = `transform var(--motion-card-move) var(--easing-enter)`;
  node.style.transform = "";

  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target !== node || event.propertyName !== "transform") return;
    node.style.transition = restoreTransition;
    node.removeEventListener("transitionend", onTransitionEnd);
  };
  node.addEventListener("transitionend", onTransitionEnd);
}
