import { ReplyField } from "@/components/attention/ReplyField";
import {
  PanelAlertBar,
  type RetryFailure,
} from "@/modules/orchestrator/components/PanelAlertBar";
import { COMMENT_BOX_ID } from "@/modules/orchestrator/domain/centre-page-state";

interface CommentBoxProps {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  disabled: boolean;
  sending: boolean;
  describedBy: string | null;
  result: string | null;
  failure: RetryFailure | null;
}

export function CommentBox({
  value,
  onChange,
  onSend,
  disabled,
  sending,
  describedBy,
  result,
  failure,
}: CommentBoxProps) {
  return (
    <div className="flex flex-col gap-(--space-sm) border-t border-border p-(--space-lg)">
      <ReplyField
        id={COMMENT_BOX_ID}
        label="Message the orchestrator"
        sendLabel="Send"
        value={value}
        onChange={onChange}
        onSend={onSend}
        disabled={disabled}
        sending={sending}
        describedBy={describedBy}
      >
        {result !== null && (
          <span role="status" className="text-sm text-muted-foreground">
            {result}
          </span>
        )}
      </ReplyField>
      {failure !== null && (
        <PanelAlertBar
          message={failure.message}
          retryDisabled={disabled || sending}
          onRetry={failure.onRetry}
        />
      )}
    </div>
  );
}
