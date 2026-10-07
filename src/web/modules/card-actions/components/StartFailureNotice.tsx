import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  START_FAILURE_COPY,
  type StartFailure,
} from "@/modules/card-actions/domain/start-copy";

interface StartFailureNoticeProps {
  failure: StartFailure;
}

export function StartFailureNotice({ failure }: StartFailureNoticeProps) {
  if (failure.variant === null) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="text-base font-normal">
          {failure.text}
        </AlertDescription>
      </Alert>
    );
  }
  const body =
    failure.variant === "ineligible"
      ? failure.text
      : START_FAILURE_COPY[failure.variant].body;
  return (
    <Alert variant="destructive">
      <AlertTitle className="leading-(--line-label)">
        {START_FAILURE_COPY[failure.variant].label}
      </AlertTitle>
      <div className="col-start-2 text-base text-muted-foreground">{body}</div>
    </Alert>
  );
}
