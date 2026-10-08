import { useMemo } from "react";
import { ProgressSection } from "@/modules/dashboard/components/ProgressSection";
import {
  loopsRunningText,
  progressRows,
} from "@/modules/dashboard/domain/progress-rows";
import { sectionState } from "@/modules/dashboard/domain/section-state";
import { retryFailed, useDashboardData } from "./use-dashboard-data";

export function ProgressContainer() {
  const { snapshot, summary, now } = useDashboardData();
  const cards = snapshot.data?.cards;
  const rows = useMemo(
    () => (cards === undefined ? [] : progressRows(cards, new Date(now))),
    [cards, now],
  );
  const countText =
    summary.data === undefined
      ? null
      : loopsRunningText(
          summary.data.runningLoops,
          summary.data.concurrencyCap,
        );
  return (
    <ProgressSection
      state={sectionState([snapshot])}
      rows={rows}
      countText={countText}
      onRetry={() => retryFailed([snapshot])}
    />
  );
}
