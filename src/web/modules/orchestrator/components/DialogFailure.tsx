import { ErrorAlert } from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";

interface DialogFailureProps {
  message: string;
  pending: boolean;
  onRetry: () => void;
}

export function DialogFailure({
  message,
  pending,
  onRetry,
}: DialogFailureProps) {
  return (
    <ErrorAlert>
      {message}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={onRetry}
      >
        Try again
      </Button>
    </ErrorAlert>
  );
}
