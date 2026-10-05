import type { AskTurn } from "../../../../shared/types.js";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { AskErrorKind } from "@/modules/ask/domain/ask-conversation";
import { AskMessage } from "./AskMessage";

const ERROR_TEXT: Record<AskErrorKind, string> = {
  busy: "Another question is still being answered. Try again in a moment.",
  timeout: "Claude took longer than 3 minutes, so the question was stopped.",
  failed: "Claude could not answer. Check that the Claude CLI is signed in.",
  invalid: "That question is too long to send.",
};

const STATUS_ROW =
  "flex items-center gap-(--space-sm) text-sm text-muted-foreground";

interface AskConversationProps {
  turns: AskTurn[];
  pending: string | null;
  error: AskErrorKind | null;
  onCancel: () => void;
  onRetry: () => void;
}

export function AskConversation({
  turns,
  pending,
  error,
  onCancel,
  onRetry,
}: AskConversationProps) {
  return (
    <div className="flex flex-col gap-(--space-lg)" aria-live="polite">
      {turns.map((turn, i) => (
        <AskMessage key={i} turn={turn} />
      ))}
      {pending !== null ? (
        <div className={STATUS_ROW}>
          <Spinner aria-hidden={true} className="size-3.5 flex-none" />
          <span>Claude is answering</span>
          <Button variant="secondary-bordered" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : null}
      {error !== null ? (
        <div className={STATUS_ROW}>
          <Alert variant="destructive" className="w-auto border-0">
            <AlertTitle className="line-clamp-none tracking-normal">
              {ERROR_TEXT[error]}
            </AlertTitle>
          </Alert>
          {error !== "invalid" ? (
            <Button variant="secondary-bordered" size="sm" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
