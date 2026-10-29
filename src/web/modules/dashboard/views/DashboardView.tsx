import { ActivityContainer } from "@/modules/dashboard/containers/ActivityContainer";
import { AttentionQueueContainer } from "@/modules/dashboard/containers/AttentionQueueContainer";
import { CostContainer } from "@/modules/dashboard/containers/CostContainer";
import { DashboardLoadingContainer } from "@/modules/dashboard/containers/DashboardLoadingContainer";
import { HeaderStripContainer } from "@/modules/dashboard/containers/HeaderStripContainer";
import { LeftStripContainer } from "@/modules/dashboard/containers/LeftStripContainer";
import { NextStepContainer } from "@/modules/dashboard/containers/NextStepContainer";
import { ProgressContainer } from "@/modules/dashboard/containers/ProgressContainer";
import { TicketsContainer } from "@/modules/dashboard/containers/TicketsContainer";

export function DashboardView() {
  return (
    <div className="scroll-stable-y dot-grid min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-360 grid-cols-1 gap-(--space-lg) p-(--space-lg) lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[repeat(7,auto)_1fr] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <DashboardLoadingContainer />
        <div className="lg:col-span-2 lg:row-start-1">
          <HeaderStripContainer />
        </div>
        <div className="min-w-0 lg:col-start-2 lg:row-start-5">
          <AttentionQueueContainer />
        </div>
        <div className="min-w-0 lg:col-span-2 lg:row-start-2">
          <ProgressContainer />
        </div>
        <div className="min-w-0 lg:col-span-2 lg:row-start-3">
          <LeftStripContainer />
        </div>
        <div className="flex min-w-0 flex-col gap-(--space-lg) lg:col-start-1 lg:row-span-5 lg:row-start-4">
          <TicketsContainer />
        </div>
        <div className="min-w-0 lg:col-start-2 lg:row-start-4">
          <NextStepContainer />
        </div>
        <div className="min-w-0 lg:col-start-2 lg:row-start-6">
          <ActivityContainer />
        </div>
        <div className="min-w-0 lg:col-start-2 lg:row-start-7">
          <CostContainer />
        </div>
      </div>
    </div>
  );
}
