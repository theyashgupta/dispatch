import { Link } from "@tanstack/react-router";
import { staleText } from "../../../../shared/stale-text.js";
import { PageHeaderActions } from "@/components/PageHeaderActions";
import { Button } from "@/components/ui/button";
import { DashboardStaleBadge } from "@/modules/dashboard/components/DashboardStaleBadge";
import { useDashboardData } from "./use-dashboard-data";

export function DashboardHeaderContainer() {
  const { boardKey, snapshot, connection } = useDashboardData();
  return (
    <>
      <DashboardStaleBadge
        staleText={staleText(
          connection === "disconnected",
          snapshot.dataUpdatedAt,
        )}
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
