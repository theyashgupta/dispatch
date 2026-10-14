import { useMemo } from "react";
import type { BoardKey } from "../../../../shared/types.js";
import {
  useAnsweredDecisionsQuery,
  useCentreDecisionsQuery,
} from "@/modules/orchestrator/queries/orchestrator-queries";

/**
 * Merge the open and the answered decision items of a board into one list.
 *
 * @remarks
 * `error` is set only for a read that holds no data, so the last list stays on screen after a failed refetch.
 */
export function useOrchestratorDecisions(board: BoardKey) {
  const open = useCentreDecisionsQuery(board);
  const answered = useAnsweredDecisionsQuery(board);
  const decisions = useMemo(
    () => [...(open.data ?? []), ...(answered.data ?? [])],
    [open.data, answered.data],
  );
  const failed = [open, answered].find(
    (q) => q.data === undefined && q.error !== null,
  );
  return {
    decisions,
    pending: open.isPending || answered.isPending,
    error: failed?.error ?? null,
    refetch: () => {
      void open.refetch();
      void answered.refetch();
    },
  };
}
