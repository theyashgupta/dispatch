import { useMemo } from "react";
import { CostSection } from "@/modules/dashboard/components/CostSection";
import { costRows } from "@/modules/dashboard/domain/cost-rows";
import { sectionState } from "@/modules/dashboard/domain/section-state";
import { usageMeters } from "@/modules/dashboard/domain/usage-meters";
import { retryFailed, useDashboardData } from "./use-dashboard-data";

export function CostContainer() {
  const { snapshot, summary, accounts } = useDashboardData();
  const cards = snapshot.data?.cards;
  const rows = useMemo(
    () => costRows(summary.data?.groups ?? []),
    [summary.data],
  );
  const meters = useMemo(
    () => usageMeters(cards ?? [], accounts.data?.accounts ?? [], {}),
    [cards, accounts.data],
  );
  return (
    <CostSection
      state={sectionState([snapshot, summary])}
      rows={rows}
      accounts={meters}
      onRetry={() => retryFailed([snapshot, summary])}
    />
  );
}
