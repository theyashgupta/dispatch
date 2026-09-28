export interface TtlCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  clear(): void;
}

/**
 * Create a map whose entries expire `ttlMs` after they were set.
 *
 * @remarks An entry is stale at exactly `ttlMs`, so a zero TTL never serves a hit.
 */
export function createTtlCache<V>(
  ttlMs: number,
  now: () => number = Date.now,
): TtlCache<V> {
  const entries = new Map<string, { value: V; at: number }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (now() - entry.at >= ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      entries.set(key, { value, at: now() });
    },
    clear() {
      entries.clear();
    },
  };
}
