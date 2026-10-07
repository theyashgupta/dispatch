import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { WorkspacesInventory } from "../../../../shared/types.js";
import { createLatestLoader } from "../../../../shared/latest-loader.js";
import { inventoryRefetchDelay } from "@/modules/workspaces/domain/inventory-refetch";
import { openEditor } from "@/queries/cards-api";
import { getWorkspaces } from "./workspaces-api.js";

export function openWorkspaceEditorMutationOptions() {
  return {
    mutationFn: (vars: { cardId: string; editor: "code" | "cursor" }) =>
      openEditor(vars.cardId, vars.editor),
  };
}

export function useOpenWorkspaceEditorMutation() {
  return useMutation(openWorkspaceEditorMutationOptions());
}

/**
 * Hold the Workspaces inventory: fetched on every mount, on `refresh()`, on `reload()` and after
 * board changes.
 *
 * @remarks
 * A board change schedules one fetch after `inventoryRefetchDelay`, and further changes add nothing
 * until it runs. `refresh()` fetches with `fresh` at once, and a request made during a load is queued
 * as one follow-up load. The inventory lives in state, so a remount never shows an earlier mount's data.
 */
export function useWorkspaceInventory(boardVersion: unknown): {
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
    let startedAt = 0;
    const latest = createLatestLoader(
      (fresh) => {
        startedAt = Date.now();
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
    return {
      request: latest.request,
      sinceLast: () => Date.now() - startedAt,
    };
  });

  useEffect(() => {
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      loader.request(false);
    }, inventoryRefetchDelay(loader.sinceLast()));
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
