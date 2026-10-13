import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  actionFailedText,
  refusalText,
  replyOutcomeText,
} from "../../../../shared/decision-view.js";
import type {
  BoardKey,
  ConversationMessage,
} from "../../../../shared/types.js";
import { readClock, subscribeClock } from "@/components/ui/hooks/wake-clock";
import { Button } from "@/components/ui/button";
import { CentreRegionAlert } from "@/modules/orchestrator/components/CentreRegionAlert";
import { CommentBox } from "@/modules/orchestrator/components/CommentBox";
import { CentreLoading } from "@/modules/orchestrator/components/CentreStates";
import {
  ConversationList,
  type DecisionFailure,
} from "@/modules/orchestrator/components/ConversationList";
import { StaleReason } from "@/modules/orchestrator/components/StaleReason";
import {
  CONVERSATION_UNAVAILABLE_TEXT,
  COMMENT_BOX_ID,
  conversationState,
  NO_MESSAGES_TEXT,
  OPEN_TERMINAL_LINK_TEXT,
  regionErrorText,
} from "@/modules/orchestrator/domain/centre-page-state";
import { conversationView } from "@/modules/orchestrator/domain/conversation-view";
import {
  actionErrorCopy,
  refusalReason,
  type OrchestratorView,
} from "@/modules/orchestrator/domain/panel-model";
import { useCentrePane } from "@/modules/orchestrator/hooks/use-centre-pane";
import {
  useAnsweredDecisionsQuery,
  useConversationQuery,
  usePanelDecisionsQuery,
} from "@/modules/orchestrator/queries/orchestrator-queries";
import {
  useAnswerDecisionMutation,
  useLoopReplyMutation,
} from "@/queries/attention-actions-queries";
import { useCentreSelection } from "./use-centre-selection";

const NO_MESSAGES: ConversationMessage[] = [];
const REASON_ID = "conversation-actions-off";

interface SendFailure {
  message: string;
  onRetry: () => void;
}

interface AnswerAttempt {
  message: string;
  optionId: string;
  note: string | null;
}

interface ConversationBodyProps {
  boardKey: BoardKey;
  stale: boolean;
  record: OrchestratorView;
  records: readonly OrchestratorView[];
}

function ConversationBody({
  boardKey,
  stale,
  record,
  records,
}: ConversationBodyProps) {
  const conversation = useConversationQuery(boardKey, record.id);
  const open = usePanelDecisionsQuery(boardKey);
  const answered = useAnsweredDecisionsQuery(boardKey);
  const answer = useAnswerDecisionMutation(boardKey);
  const now = useSyncExternalStore(subscribeClock, readClock);
  const reply = useLoopReplyMutation(boardKey);
  const { page, pane, focusPending, setPane, takeCommentFocus } =
    useCentrePane();
  const [draft, setDraft] = useState("");
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [sendFailure, setSendFailure] = useState<SendFailure | null>(null);
  const [attempts, setAttempts] = useState<Record<string, AnswerAttempt>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(
    () =>
      conversationView({
        messages: conversation.data?.messages ?? NO_MESSAGES,
        decisions: [...(open.data ?? []), ...(answered.data ?? [])],
        orchestratorId: record.id,
        orchestratorName: record.name,
        orchestratorNames: new Map(records.map((r) => [r.id, r.name])),
        now,
      }),
    [conversation.data, open.data, answered.data, record, records, now],
  );
  const lastId = entries.at(-1)?.id;
  const state = conversationState({
    pending: conversation.isPending,
    error: conversation.data === undefined && conversation.error !== null,
    status: conversation.data?.status ?? null,
    entryCount: entries.length,
  });

  useEffect(() => {
    const region = scrollRef.current;
    if (region !== null) region.scrollTop = region.scrollHeight;
  }, [lastId, state, page, pane, stale, sendResult, sendFailure]);

  useEffect(() => {
    if (!takeCommentFocus()) return;
    requestAnimationFrame(() =>
      document.getElementById(COMMENT_BOX_ID)?.focus(),
    );
  }, [focusPending, takeCommentFocus]);

  async function onSend(text: string) {
    if (record.cardId === null) return;
    setSendResult(null);
    setSendFailure(null);
    const outcome = await reply.mutateAsync({ cardId: record.cardId, text });
    const result = replyOutcomeText(
      outcome,
      record.name,
      record.session?.state ?? undefined,
    );
    setSendResult(result);
    if (!outcome.ok && result === null) {
      setSendFailure({
        message: actionFailedText(
          "Message",
          refusalText(outcome.error, outcome.reason),
        ),
        onRetry: () => void onSend(text),
      });
    }
    if (outcome.ok && outcome.result === "confirmed") {
      setDraft((current) => (current.trim() === text ? "" : current));
    }
  }

  async function onAnswer(
    id: string,
    optionId: string,
    note: string | null,
  ): Promise<boolean> {
    setAttempts((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id)),
    );
    const result = await answer.mutateAsync({ id, optionId, note });
    if (!result.ok) {
      const message = actionErrorCopy(
        "Decision answer",
        refusalReason(result.error, result.reason),
      );
      setAttempts((prev) => ({ ...prev, [id]: { message, optionId, note } }));
    }
    return result.ok;
  }

  const disabled = stale || answer.isPending;
  const failures: Record<string, DecisionFailure> = Object.fromEntries(
    Object.entries(attempts).map(([id, a]) => [
      id,
      {
        message: a.message,
        onRetry: () => void onAnswer(id, a.optionId, a.note),
      },
    ]),
  );

  const body =
    state === "loading" ? (
      <CentreLoading />
    ) : state === "error" ? (
      <CentreRegionAlert
        message={regionErrorText(
          "Conversation",
          conversation.error?.message ?? "the request failed",
        )}
        onRetry={() => void conversation.refetch()}
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
              onClick={() => setPane("terminal")}
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
            disabled={disabled}
            failures={failures}
            onAnswer={onAnswer}
          />
        )}
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {body}
      </div>
      {stale && <StaleReason id={REASON_ID} padded />}
      <CommentBox
        value={draft}
        onChange={setDraft}
        onSend={() => void onSend(draft.trim())}
        disabled={stale || record.cardId === null}
        sending={reply.isPending}
        describedBy={stale ? REASON_ID : null}
        result={sendResult}
        failure={sendFailure}
      />
    </div>
  );
}

export function ConversationContainer() {
  const { boardKey, stale, panel, record, records } = useCentreSelection();
  if (record === null) {
    if (panel.isPending) return <CentreLoading />;
    if (panel.data === undefined) return null;
    return (
      <p className="m-0 p-(--space-lg) text-sm text-muted-foreground">
        {NO_MESSAGES_TEXT}
      </p>
    );
  }
  return (
    <ConversationBody
      key={record.id}
      boardKey={boardKey}
      stale={stale}
      record={record}
      records={records}
    />
  );
}
