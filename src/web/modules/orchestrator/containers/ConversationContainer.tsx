import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  BoardKey,
  ConversationMessage,
} from "../../../../shared/types.js";
import { readClock, subscribeClock } from "@/components/ui/hooks/wake-clock";
import { CentreRegionAlert } from "@/modules/orchestrator/components/CentreRegionAlert";
import { CentreLoading } from "@/modules/orchestrator/components/CentreStates";
import {
  ConversationList,
  type DecisionFailure,
} from "@/modules/orchestrator/components/ConversationList";
import { StaleReason } from "@/modules/orchestrator/components/StaleReason";
import {
  CONVERSATION_UNAVAILABLE_TEXT,
  conversationState,
  NO_MESSAGES_TEXT,
  regionErrorText,
} from "@/modules/orchestrator/domain/centre-page-state";
import { conversationView } from "@/modules/orchestrator/domain/conversation-view";
import {
  actionErrorCopy,
  refusalReason,
  type OrchestratorView,
} from "@/modules/orchestrator/domain/panel-model";
import {
  useAnsweredDecisionsQuery,
  useConversationQuery,
  usePanelDecisionsQuery,
} from "@/modules/orchestrator/queries/orchestrator-queries";
import { useAnswerDecisionMutation } from "@/queries/attention-actions-queries";
import { useCentreSelection } from "./use-centre-selection";

const NO_MESSAGES: ConversationMessage[] = [];
const REASON_ID = "conversation-actions-off";

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
  const [attempts, setAttempts] = useState<Record<string, AnswerAttempt>>({});
  const endRef = useRef<HTMLDivElement>(null);

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
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

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

  if (state === "loading") return <CentreLoading />;
  if (state === "error") {
    return (
      <CentreRegionAlert
        message={regionErrorText(
          "Conversation",
          conversation.error?.message ?? "the request failed",
        )}
        onRetry={() => void conversation.refetch()}
      />
    );
  }
  return (
    <div className="flex flex-col gap-(--space-md) p-(--space-lg)">
      {stale && <StaleReason id={REASON_ID} padded={false} />}
      {state === "unavailable" && (
        <p className="m-0 text-sm text-muted-foreground">
          {CONVERSATION_UNAVAILABLE_TEXT}
        </p>
      )}
      {state === "empty" && (
        <p className="m-0 text-sm text-muted-foreground">{NO_MESSAGES_TEXT}</p>
      )}
      {entries.length > 0 && (
        <ConversationList
          entries={entries}
          disabled={disabled}
          failures={failures}
          onAnswer={onAnswer}
          endRef={endRef}
        />
      )}
    </div>
  );
}

export function ConversationContainer() {
  const { boardKey, stale, record, records } = useCentreSelection();
  if (record === null) return null;
  return (
    <ConversationBody
      boardKey={boardKey}
      stale={stale}
      record={record}
      records={records}
    />
  );
}
