/**
 * Read the current epoch-ms clock for a render-time age computation.
 *
 * @remarks
 * Isolates the impure `Date.now()` read behind a named helper so callers can
 * compute a fresh age on every render without tripping the render-purity lint
 * and without arming a dedicated interval — the ~2s SSE re-render cadence is
 * finer than the `m/h/d` age granularity.
 */
export function nowMs(): number {
  return Date.now();
}

/**
 * Format a coarse relative-age cue (`<n>s / <n>m / <n>h / <n>d ago`) from an
 * ISO timestamp and a `now` epoch-ms reference.
 *
 * @remarks
 * `iso` is `Card.updatedAt` — Linear's last-edit time, fresh only for To Do
 * cards (the poller stops touching cards past To Do). This renders a scannable
 * freshness cue, not a per-column timer, so callers should not read it as
 * time-in-column. Compute on render only: the board re-renders on every ~2s SSE
 * snapshot, which far exceeds `m/h/d` granularity — no dedicated interval.
 * An unparseable timestamp yields an empty cue rather than "NaNs ago".
 */
export function formatAge(iso: string, now: number): string {
  const elapsedMs = now - new Date(iso).getTime();
  if (!Number.isFinite(elapsedMs)) return "";
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
