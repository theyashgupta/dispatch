const ITEM_WAKE_TICK_MS = 60_000;

const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;

/**
 * Subscribe to the shared wake clock, starting its one interval on the first subscriber.
 *
 * @remarks Every reader shares one tick, so the nav count and the page list wake an item in
 * the same frame.
 */
export function subscribeClock(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === undefined) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, ITEM_WAKE_TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/**
 * Read the time of the latest shared tick.
 */
export function readClock(): number {
  return now;
}
