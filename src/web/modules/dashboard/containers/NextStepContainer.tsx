import { useMemo } from "react";
import { NextStepSection } from "@/modules/dashboard/components/NextStepSection";
import { nextStep } from "@/modules/dashboard/domain/header-strip";
import { sectionState } from "@/modules/dashboard/domain/section-state";
import { retryFailed, useDashboardData } from "./use-dashboard-data";

export function NextStepContainer() {
  const { snapshot } = useDashboardData();
  const cards = snapshot.data?.cards;
  const step = useMemo(() => nextStep(cards ?? []), [cards]);
  return (
    <NextStepSection
      state={sectionState([snapshot])}
      step={step}
      onRetry={() => retryFailed([snapshot])}
    />
  );
}
