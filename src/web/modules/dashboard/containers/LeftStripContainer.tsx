import { useMemo } from "react";
import { LeftStripSection } from "@/modules/dashboard/components/LeftStripSection";
import { sectionState } from "@/modules/dashboard/domain/section-state";
import { leftOnBoard } from "@/modules/dashboard/domain/ticket-tiles";
import { retryFailed, useDashboardData } from "./use-dashboard-data";

export function LeftStripContainer() {
  const { snapshot } = useDashboardData();
  const cards = snapshot.data?.cards;
  const items = useMemo(() => leftOnBoard(cards ?? []), [cards]);
  return (
    <LeftStripSection
      state={sectionState([snapshot])}
      items={items}
      onRetry={() => retryFailed([snapshot])}
    />
  );
}
