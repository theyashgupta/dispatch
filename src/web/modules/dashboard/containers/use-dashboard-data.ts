import { useSyncExternalStore } from "react";
import type { OrchestratorRecord } from "../../../../shared/types.js";
import { useRouteContext } from "@tanstack/react-router";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { readClock, subscribeClock } from "@/components/ui/hooks/wake-clock";
import {
  useOrchestrationEventsQuery,
  useOrchestrationSummaryQuery,
} from "@/modules/dashboard/queries/orchestration-queries";
import { useAccountsQuery } from "@/queries/accounts-queries";
import { useOpenDecisionsQuery } from "@/queries/attention-actions-queries";
import { useBoardListQuery } from "@/queries/board-list-queries";
import { useBoardSnapshotQuery } from "@/queries/board-snapshot-queries";

const EVENTS_PAGE = { limit: 200 };
const NO_ORCHESTRATORS: OrchestratorRecord[] = [];

/**
 * Read every input of the dashboard sections for the selected board.
 *
 * @remarks Each section container calls this hook, and TanStack Query shares one request per key,
 * so no section fetches twice. The snapshot shares the shell's done limit, so it reads the cache
 * the stream already fills.
 */
export function useDashboardData() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const boardKey = useAppStore(appStore, (s) => s.board);
  const doneLimit = useAppStore(appStore, (s) => s.doneLimit);
  const connection = useAppStore(appStore, (s) => s.connection);
  const snapshot = useBoardSnapshotQuery(boardKey, doneLimit);
  const summary = useOrchestrationSummaryQuery(boardKey);
  const events = useOrchestrationEventsQuery(boardKey, EVENTS_PAGE);
  const decisions = useOpenDecisionsQuery(boardKey);
  const accounts = useAccountsQuery();
  const orchestrators =
    useBoardListQuery(
      (list) => list.boards.find((b) => b.key === boardKey)?.orchestrators,
    ).data ?? NO_ORCHESTRATORS;
  const now = useSyncExternalStore(subscribeClock, readClock);
  return {
    boardKey,
    snapshot,
    summary,
    events,
    decisions,
    accounts,
    orchestrators,
    now,
    connection,
  };
}

/** Refetch the queries that failed, for the "Try again" button of a section. */
export function retryFailed(
  queries: readonly { isError: boolean; refetch: () => unknown }[],
): void {
  for (const query of queries) {
    if (query.isError) void query.refetch();
  }
}
