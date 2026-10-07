export interface FlipRect {
  left: number;
  top: number;
  at: number;
}

export interface FlipPoint {
  left: number;
  top: number;
}

export const FLIP_STALE_MS = 100;

export const MAX_TRACKED_CARDS = 300;

/**
 * The translate that inverts a card's cross-column move, or null when no flip plays.
 *
 * @remarks
 * A move records and plays inside one React commit, so a suppression mark or stored rect older
 * than `FLIP_STALE_MS` is not part of the current move. `readNext` is lazy so a skipped flip never
 * forces a layout read.
 */
export function cardMoveFlipDelta(
  prev: FlipRect | undefined,
  suppressedAt: number | undefined,
  now: number,
  readNext: () => FlipPoint,
): { dx: number; dy: number } | null {
  if (suppressedAt != null && now - suppressedAt <= FLIP_STALE_MS) return null;
  if (prev == null || now - prev.at > FLIP_STALE_MS) return null;
  const next = readNext();
  const dx = prev.left - next.left;
  const dy = prev.top - next.top;
  return dx === 0 && dy === 0 ? null : { dx, dy };
}
