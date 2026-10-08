import { useMemo } from "react";
import { ShipSection } from "@/modules/dashboard/components/ShipSection";
import { sectionState } from "@/modules/dashboard/domain/section-state";
import { shipBlocks } from "@/modules/dashboard/domain/ship-rows";
import { retryFailed, useDashboardData } from "./use-dashboard-data";

export function ShipContainer() {
  const { snapshot } = useDashboardData();
  const cards = snapshot.data?.cards;
  const blocks = useMemo(() => shipBlocks(cards ?? []), [cards]);
  return (
    <ShipSection
      state={sectionState([snapshot])}
      blocks={blocks}
      onRetry={() => retryFailed([snapshot])}
    />
  );
}
