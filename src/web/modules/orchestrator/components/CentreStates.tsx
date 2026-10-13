import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelAlertBar } from "@/modules/orchestrator/components/PanelAlertBar";
import {
  LOADING_TEXT,
  NO_ORCHESTRATOR_TEXT,
} from "@/modules/orchestrator/domain/centre-page-state";

const PLACEHOLDERS = [0, 1, 2];

export function CentreLoading() {
  return (
    <div className="flex flex-col gap-(--space-sm) p-(--space-xl)">
      <p className="sr-only" role="status">
        {LOADING_TEXT}
      </p>
      <div aria-hidden="true" className="flex flex-col gap-(--space-sm)">
        {PLACEHOLDERS.map((n) => (
          <Skeleton key={n} className="h-20 w-full max-w-120" />
        ))}
      </div>
    </div>
  );
}

export interface NoOrchestratorProps {
  startDisabled: boolean;
  reason: string | null;
  onStart: () => void;
  alert: {
    message: string;
    onRetry: () => void;
    retryDisabled: boolean;
  } | null;
}

export function NoOrchestrator({
  startDisabled,
  reason,
  onStart,
  alert,
}: NoOrchestratorProps) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{NO_ORCHESTRATOR_TEXT}</EmptyTitle>
        {reason !== null && <EmptyDescription>{reason}</EmptyDescription>}
      </EmptyHeader>
      <Button type="button" disabled={startDisabled} onClick={onStart}>
        Start
      </Button>
      {alert !== null && (
        <PanelAlertBar
          message={alert.message}
          retryDisabled={alert.retryDisabled}
          onRetry={alert.onRetry}
        />
      )}
    </Empty>
  );
}
