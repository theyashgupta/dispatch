import { DashboardStaleBadge } from "@/modules/dashboard/components/DashboardStaleBadge";
import { staleBadgeText } from "@/modules/dashboard/domain/section-state";
import { useDashboardData } from "./use-dashboard-data";

export function DashboardHeaderContainer() {
  const { snapshot, connection } = useDashboardData();
  return (
    <DashboardStaleBadge
      staleText={staleBadgeText(connection, snapshot.dataUpdatedAt)}
    />
  );
}
