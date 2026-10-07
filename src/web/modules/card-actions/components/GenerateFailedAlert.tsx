import { Alert, AlertDescription } from "@/components/ui/alert";
import { GENERATE_FAILED_COPY } from "@/modules/card-actions/domain/ticket-copy";

export function GenerateFailedAlert() {
  return (
    <Alert variant="destructive">
      <AlertDescription className="font-semibold">
        {GENERATE_FAILED_COPY}
      </AlertDescription>
    </Alert>
  );
}
