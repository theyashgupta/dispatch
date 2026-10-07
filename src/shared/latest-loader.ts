export interface LatestLoader {
  request: (fresh: boolean) => void;
}

/**
 * Runs one load at a time and folds every request made meanwhile into a single follow-up load.
 *
 * @remarks A request that arrives mid-load is queued rather than dropped, and a queued fresh
 * request stays fresh, so a Refresh click during a slow scan still clears the server caches.
 */
export function createLatestLoader<T>(
  fetch: (fresh: boolean) => Promise<T>,
  on: {
    result: (value: T) => void;
    error: (err: unknown) => void;
    busy: (busy: boolean) => void;
  },
): LatestLoader {
  let inFlight = false;
  let pending: boolean | null = null;
  function run(fresh: boolean): void {
    inFlight = true;
    fetch(fresh)
      .then(on.result, on.error)
      .finally(() => {
        const next = pending;
        pending = null;
        if (next !== null) {
          run(next);
          return;
        }
        inFlight = false;
        on.busy(false);
      });
  }
  return {
    request(fresh) {
      if (inFlight) {
        pending = (pending ?? false) || fresh;
        return;
      }
      on.busy(true);
      run(fresh);
    },
  };
}
