import { useMemo } from "react";
import { buildAttentionQueue } from "../../../../shared/attention-queue.js";
import { decisionViews } from "../../../../shared/decision-view.js";
import { attentionRows } from "@/modules/dashboard/domain/attention-rows";
import { useDashboardData } from "./use-dashboard-data";

/**
 * Build the attention rows of the selected board.
 *
 * @remarks The queue section and the header strip both read this hook, so the count in the strip is
 * always the number of rows the queue shows.
 */
export function useAttentionRows() {
  const {
    boardKey,
    snapshot,
    summary,
    events,
    decisions,
    accounts,
    orchestrators,
    now,
  } = useDashboardData();
  const cards = snapshot.data?.cards;
  const pushoverMissing = snapshot.data?.pushoverMissing;
  return useMemo(() => {
    if (cards === undefined || decisions.data === undefined) return [];
    const items = buildAttentionQueue({
      boardKey,
      cards,
      decisions: decisions.data,
      events: events.data,
      pushoverMissing,
      now: new Date(now),
    });
    return attentionRows(items, {
      boardKey,
      cards,
      accounts: accounts.data?.accounts ?? [],
      groups: summary.data?.groups ?? [],
      decisions: decisionViews(
        decisions.data,
        new Map(orchestrators.map((r) => [r.id, r.name])),
        now,
      ),
    });
  }, [
    boardKey,
    cards,
    pushoverMissing,
    decisions.data,
    events.data,
    accounts.data,
    summary.data,
    orchestrators,
    now,
  ]);
}
