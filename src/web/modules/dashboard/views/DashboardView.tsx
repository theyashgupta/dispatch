import { ActivityContainer } from "@/modules/dashboard/containers/ActivityContainer";
import { AttentionQueueContainer } from "@/modules/dashboard/containers/AttentionQueueContainer";
import { CostContainer } from "@/modules/dashboard/containers/CostContainer";
import { DashboardLoadingContainer } from "@/modules/dashboard/containers/DashboardLoadingContainer";
import { ProgressContainer } from "@/modules/dashboard/containers/ProgressContainer";
import { ShipContainer } from "@/modules/dashboard/containers/ShipContainer";
import { TicketsContainer } from "@/modules/dashboard/containers/TicketsContainer";

export function DashboardView() {
  return (
    <div className="scroll-stable-y min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-280 flex-col gap-(--space-xl) p-(--space-lg)">
        <DashboardLoadingContainer />
        <AttentionQueueContainer />
        <ProgressContainer />
        <TicketsContainer />
        <ActivityContainer />
        <ShipContainer />
        <CostContainer />
      </div>
    </div>
  );
}
