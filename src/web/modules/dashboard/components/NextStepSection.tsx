import type { NextStep } from "@/modules/dashboard/domain/header-strip";
import type { SectionState } from "@/modules/dashboard/domain/section-state";
import { DashboardSection } from "./DashboardSection";

interface NextStepSectionProps {
  state: SectionState;
  step: NextStep;
  onRetry: () => void;
}

export function NextStepSection({
  state,
  step,
  onRetry,
}: NextStepSectionProps) {
  return (
    <DashboardSection
      title="Next step"
      count={null}
      state={state}
      onRetry={onRetry}
    >
      <div className="flex flex-col gap-(--space-xs)">
        <p className="m-0 text-(length:--font-rail-headline) leading-(--line-heading) font-semibold wrap-anywhere text-foreground">
          {step.headline}
        </p>
        <p className="m-0 text-sm text-muted-foreground">{step.detail}</p>
      </div>
    </DashboardSection>
  );
}
