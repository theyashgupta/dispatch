import { Link, useRouteContext } from "@tanstack/react-router";
import { PageHeaderActions } from "@/components/PageHeaderActions";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { DashboardStaleBadge } from "@/modules/dashboard/components/DashboardStaleBadge";
import { staleBadgeText } from "@/modules/dashboard/domain/section-state";
import { useDashboardData } from "./use-dashboard-data";

export function DashboardHeaderContainer() {
  const { snapshot, connection } = useDashboardData();
  const { appStore } = useRouteContext({ from: "__root__" });
  const boardKey = useAppStore(appStore, (s) => s.board);
  return (
    <>
      <DashboardStaleBadge
        staleText={staleBadgeText(connection, snapshot.dataUpdatedAt)}
      />
      <PageHeaderActions>
        <Button asChild variant="outline" size="sm">
          <Link
            to="/boards/$key/orchestrator/{-$id}"
            params={{ key: boardKey }}
          >
            Open command centre
          </Link>
        </Button>
      </PageHeaderActions>
    </>
  );
}
