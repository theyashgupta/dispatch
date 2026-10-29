import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { staleText as staleTextOf } from "../../../../shared/stale-text.js";
import { Button } from "@/components/ui/button";
import { HeaderStrip } from "@/modules/dashboard/components/HeaderStrip";
import {
  NEEDS_YOUR_CALL_ID,
  gatesPassedToday,
  gatesText,
  needsCallText,
  spentText,
} from "@/modules/dashboard/domain/header-strip";
import { orchestratorScopeText } from "@/modules/dashboard/domain/orchestrator-scope-text";
import { loopsRunningText } from "@/modules/dashboard/domain/progress-rows";
import { clock } from "@/modules/dashboard/domain/usage-meters";
import { useAttentionRows } from "./use-attention-rows";
import { useDashboardData } from "./use-dashboard-data";

function focusNeedsYourCall() {
  const target = document.getElementById(NEEDS_YOUR_CALL_ID);
  target?.scrollIntoView({ block: "start" });
  target?.focus({ preventScroll: true });
}

export function HeaderStripContainer() {
  const {
    boardKey,
    snapshot,
    summary,
    decisions,
    boardName,
    connection,
    now,
    orchestrators,
  } = useDashboardData();
  const needsCount = useAttentionRows().length;
  const cards = snapshot.data?.cards;
  const updatedAt = snapshot.dataUpdatedAt;
  const staleText = staleTextOf(connection === "disconnected", updatedAt);
  const facts = useMemo(() => {
    const synced =
      staleText !== null || updatedAt === 0
        ? null
        : `Synced ${clock(new Date(updatedAt).toISOString(), undefined, false)}`;
    return [
      synced,
      summary.data === undefined
        ? null
        : loopsRunningText(
            summary.data.runningLoops,
            summary.data.concurrencyCap,
          ),
      cards === undefined
        ? null
        : gatesText(gatesPassedToday(cards, new Date(now))),
      summary.data === undefined ? null : spentText(summary.data.groups),
      orchestratorScopeText(orchestrators, cards ?? []),
    ].filter((fact) => fact !== null);
  }, [staleText, updatedAt, summary.data, cards, now, orchestrators]);
  return (
    <HeaderStrip
      boardName={boardName}
      staleText={staleText}
      facts={facts}
      needsCount={needsCount}
      needsText={
        snapshot.data !== undefined && decisions.data !== undefined
          ? needsCallText(needsCount)
          : null
      }
      action={
        <Button asChild variant="outline" size="sm">
          <Link
            to="/boards/$key/orchestrator/{-$id}"
            params={{ key: boardKey }}
          >
            Open command centre
          </Link>
        </Button>
      }
      onNeedsClick={focusNeedsYourCall}
    />
  );
}
