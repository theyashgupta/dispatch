import { useMemo } from "react";
import { HeaderStrip } from "@/modules/dashboard/components/HeaderStrip";
import {
  NEEDS_YOUR_CALL_ID,
  gatesPassedToday,
  gatesText,
  needsCallText,
  spentText,
} from "@/modules/dashboard/domain/header-strip";
import { loopsRunningText } from "@/modules/dashboard/domain/progress-rows";
import { staleBadgeText } from "@/modules/dashboard/domain/section-state";
import { clock } from "@/modules/dashboard/domain/usage-meters";
import { useAttentionRows } from "./use-attention-rows";
import { useDashboardData } from "./use-dashboard-data";

function focusNeedsYourCall() {
  const target = document.getElementById(NEEDS_YOUR_CALL_ID);
  target?.scrollIntoView({ block: "start" });
  target?.focus({ preventScroll: true });
}

export function HeaderStripContainer() {
  const { snapshot, summary, decisions, boardName, connection, now } =
    useDashboardData();
  const needsCount = useAttentionRows().length;
  const cards = snapshot.data?.cards;
  const updatedAt = snapshot.dataUpdatedAt;
  const staleText = staleBadgeText(connection, updatedAt);
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
    ].filter((fact) => fact !== null);
  }, [staleText, updatedAt, summary.data, cards, now]);
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
      onNeedsClick={focusNeedsYourCall}
    />
  );
}
