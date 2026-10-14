import type { Ref } from "react";
import { Button } from "@/components/ui/button";
import { CentreRegionAlert } from "@/modules/orchestrator/components/CentreRegionAlert";
import { CentreLoading } from "@/modules/orchestrator/components/CentreStates";
import { CommentBox } from "@/modules/orchestrator/components/CommentBox";
import { ConversationList } from "@/modules/orchestrator/components/ConversationList";
import type { RetryFailure } from "@/modules/orchestrator/components/CentreAlertBar";
import { StaleReason } from "@/modules/orchestrator/components/StaleReason";
import {
  CONVERSATION_UNAVAILABLE_TEXT,
  NO_MESSAGES_TEXT,
  OPEN_TERMINAL_LINK_TEXT,
  type conversationState,
} from "@/modules/orchestrator/domain/centre-page-state";
import type { ConversationEntry } from "@/modules/orchestrator/domain/conversation-view";

const REASON_ID = "conversation-actions-off";

interface ConversationPaneProps {
  state: ReturnType<typeof conversationState>;
  conversationError: RetryFailure;
  decisionsError: RetryFailure | null;
  entries: readonly ConversationEntry[];
  stale: boolean;
  answering: boolean;
  failures: Readonly<Partial<Record<string, RetryFailure>>>;
  onAnswer: (
    id: string,
    optionId: string,
    note: string | null,
  ) => Promise<boolean>;
  onOpenTerminal: () => void;
  scrollRef: Ref<HTMLDivElement>;
  draft: string;
  onDraftChange: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  sendResult: string | null;
  sendFailure: RetryFailure | null;
}

export function ConversationPane({
  state,
  conversationError,
  decisionsError,
  entries,
  stale,
  answering,
  failures,
  onAnswer,
  onOpenTerminal,
  scrollRef,
  draft,
  onDraftChange,
  onSend,
  sending,
  sendResult,
  sendFailure,
}: ConversationPaneProps) {
  const body =
    state === "loading" ? (
      <CentreLoading />
    ) : state === "error" ? (
      <CentreRegionAlert
        message={conversationError.message}
        onRetry={conversationError.onRetry}
      />
    ) : (
      <div className="flex flex-col gap-(--space-md) p-(--space-lg)">
        {state === "unavailable" && (
          <p className="m-0 text-sm text-muted-foreground">
            {CONVERSATION_UNAVAILABLE_TEXT}{" "}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={onOpenTerminal}
            >
              {OPEN_TERMINAL_LINK_TEXT}
            </Button>
          </p>
        )}
        {state === "empty" && (
          <p className="m-0 text-sm text-muted-foreground">
            {NO_MESSAGES_TEXT}
          </p>
        )}
        {entries.length > 0 && (
          <ConversationList
            entries={entries}
            disabled={stale || answering}
            failures={failures}
            onAnswer={onAnswer}
          />
        )}
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        role="region"
        aria-label="Conversation messages"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {decisionsError !== null && (
          <CentreRegionAlert
            message={decisionsError.message}
            onRetry={decisionsError.onRetry}
          />
        )}
        {body}
      </div>
      {stale && <StaleReason id={REASON_ID} padded />}
      <CommentBox
        value={draft}
        onChange={onDraftChange}
        onSend={onSend}
        disabled={stale}
        sending={sending}
        describedBy={stale ? REASON_ID : null}
        result={sendResult}
        failure={sendFailure}
      />
    </div>
  );
}
