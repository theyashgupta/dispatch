import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type RetryFailure = Pick<PanelAlertBarProps, "message" | "onRetry">;

interface PanelAlertBarProps {
  message: string;
  onRetry: () => void;
  retryDisabled: boolean;
}

export function PanelAlertBar({
  message,
  onRetry,
  retryDisabled,
}: PanelAlertBarProps) {
  return (
    <Alert variant="destructive" className="items-center">
      <TriangleAlert aria-hidden="true" />
      <AlertDescription className="text-destructive-text">
        <span>{message}</span>
        <Button
          size="xs"
          variant="outline"
          disabled={retryDisabled}
          onClick={onRetry}
        >
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
