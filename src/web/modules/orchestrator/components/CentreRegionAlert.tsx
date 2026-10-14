import { CentreAlertBar } from "@/modules/orchestrator/components/CentreAlertBar";

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
      <CentreAlertBar
        message={message}
        retryDisabled={false}
        onRetry={onRetry}
      />
    </div>
  );
}
