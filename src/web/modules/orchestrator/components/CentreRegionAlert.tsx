import { PanelAlertBar } from "@/modules/orchestrator/components/PanelAlertBar";

interface CentreRegionAlertProps {
  message: string;
  onRetry: () => void;
}

export function CentreRegionAlert({
  message,
  onRetry,
}: CentreRegionAlertProps) {
  return (
    <div className="p-(--space-xl)">
      <PanelAlertBar
        message={message}
        retryDisabled={false}
        onRetry={onRetry}
      />
    </div>
  );
}
