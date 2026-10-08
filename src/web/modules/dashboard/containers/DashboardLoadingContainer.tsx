import { DashboardLoadingStatus } from "@/modules/dashboard/components/DashboardLoadingStatus";
import { sectionState } from "@/modules/dashboard/domain/section-state";
import { useDashboardData } from "./use-dashboard-data";

export function DashboardLoadingContainer() {
  const { snapshot, summary, events, decisions, accounts } = useDashboardData();
  const loading = [snapshot, summary, events, decisions, accounts].some(
    (query) => sectionState([query]).kind === "loading",
  );
  return <DashboardLoadingStatus loading={loading} />;
}
