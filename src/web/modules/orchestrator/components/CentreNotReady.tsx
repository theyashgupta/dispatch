import { CentreRegionAlert } from "@/modules/orchestrator/components/CentreRegionAlert";
import {
  CentreLoading,
  NoOrchestrator,
  type NoOrchestratorProps,
} from "@/modules/orchestrator/components/CentreStates";
import type { RegionState } from "@/modules/orchestrator/domain/centre-page-state";

interface CentreNotReadyProps {
  state: RegionState;
  error: { message: string; onRetry: () => void };
  start: NoOrchestratorProps;
}

export function CentreNotReady({ state, error, start }: CentreNotReadyProps) {
  switch (state) {
    case "loading":
      return <CentreLoading />;
    case "error":
      return (
        <CentreRegionAlert message={error.message} onRetry={error.onRetry} />
      );
    case "empty":
      return <NoOrchestrator {...start} />;
    case "ready":
      return null;
  }
}
