import { useEffect, useRef, useState } from "react";
import type { WorkspacesInventory } from "../../shared/types.js";
import { getWorkspaces } from "../lib/api.js";
import { createLatestLoader } from "../lib/latest-loader.js";

const BOARD_REFRESH_GAP_MS = 5_000;

/**
 * The Workspaces inventory, fetched on mount, on `refresh()` and after board changes.
 *
 * @remarks Board-driven refetches are throttled to one per 5 s because frames arrive on every
 * card change; `refresh()` bypasses the throttle and asks the server to drop its caches.
 */
export function useWorkspaces(boardVersion: unknown): {
  inventory: WorkspacesInventory | null;
  loading: boolean;
  error: boolean;
  refresh: () => void;
  reload: () => void;
} {
  const [inventory, setInventory] = useState<WorkspacesInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loader] = useState(() => {
    let lastAt = 0;
    const latest = createLatestLoader(
      (fresh) => {
        lastAt = Date.now();
        return getWorkspaces(fresh);
      },
      {
        result: (next) => {
          setInventory(next);
          setError(false);
        },
        error: (err) => {
          console.error("getWorkspaces failed", err);
          setError(true);
        },
        busy: setLoading,
      },
    );
    return { request: latest.request, sinceLast: () => Date.now() - lastAt };
  });

  useEffect(() => {
    if (timer.current !== null) return;
    const wait = Math.max(0, BOARD_REFRESH_GAP_MS - loader.sinceLast());
    timer.current = setTimeout(() => {
      timer.current = null;
      loader.request(false);
    }, wait);
  }, [boardVersion, loader]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  return {
    inventory,
    loading,
    error,
    refresh: () => loader.request(true),
    reload: () => loader.request(false),
  };
}
