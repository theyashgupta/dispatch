import { useCallback, useEffect, useState } from "react";
import type { ActivityEvent } from "../../shared/types.js";
import { fetchEvents } from "../lib/api.js";

const BUFFER_CAP = 200;

/**
 * Union two event lists deduped by `id`, sorted newest-first (`id` descending), capped at
 * {@link BUFFER_CAP}. Used for BOTH hydrate and append so neither ordering — an SSE frame arriving
 * before the initial fetch resolves, or after — can ever drop an event.
 */
function merge(a: ActivityEvent[], b: ActivityEvent[]): ActivityEvent[] {
  const byId = new Map<number, ActivityEvent>();
  for (const event of a) byId.set(event.id, event);
  for (const event of b) byId.set(event.id, event);
  return [...byId.values()].sort((x, y) => y.id - x.id).slice(0, BUFFER_CAP);
}

/**
 * Rolling in-memory activity buffer: hydrated ONCE via `GET /api/events` on mount and appended live
 * from the single stream's `activity` frame (wire the returned `append` to `useBoardStream`'s
 * `onActivity`). No second EventSource, no polling, no loading/error surface — on a failed hydrate
 * the buffer keeps whatever SSE already fed it (FEED-03).
 */
export function useActivityFeed(): {
  events: ActivityEvent[];
  append: (event: ActivityEvent) => void;
} {
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  const append = useCallback((event: ActivityEvent) => {
    setEvents((prev) => merge([event], prev));
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const fetched = await fetchEvents();
        if (!active) return;
        setEvents((prev) => merge(fetched, prev));
      } catch {}
    })();
    return () => {
      active = false;
    };
  }, []);

  return { events, append };
}
