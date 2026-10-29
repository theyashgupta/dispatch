import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type {
  BoardKey,
  ConversationMessage,
} from "../../../../shared/types.js";
import { readClock, subscribeClock } from "@/components/ui/hooks/wake-clock";
import {
  CentreLoading,
  CentreNoMessages,
} from "@/modules/orchestrator/components/CentreStates";
import { ConversationPane } from "@/modules/orchestrator/components/ConversationPane";
import {
  conversationState,
  regionErrorText,
} from "@/modules/orchestrator/domain/centre-page-state";
import { conversationView } from "@/modules/orchestrator/domain/conversation-view";
import type { OrchestratorView } from "@/modules/orchestrator/domain/centre-model";
import { focusCommentBox } from "@/modules/orchestrator/hooks/focus-entry";
import { useCentrePane } from "@/modules/orchestrator/hooks/use-centre-pane";
import { usePinnedToEnd } from "@/modules/orchestrator/hooks/use-pinned-to-end";
import { useConversationQuery } from "@/modules/orchestrator/queries/orchestrator-queries";
import { useCentreSelection } from "./use-centre-selection";
import { useConversationActions } from "./use-conversation-actions";
import { useOrchestratorDecisions } from "./use-orchestrator-decisions";

const EMPTY_MESSAGES: ConversationMessage[] = [];

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
  const {
    decisions,
    pending: decisionsPending,
    error: decisionsError,
    refetch: refetchDecisions,
  } = useOrchestratorDecisions(boardKey);
  const now = useSyncExternalStore(subscribeClock, readClock);
  const { page, pane, focusPending, setPane, takeCommentFocus } =
    useCentrePane();
  const actions = useConversationActions(
    boardKey,
    record,
    () => void conversation.refetch(),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  usePinnedToEnd(scrollRef);

  const entries = useMemo(
    () =>
      conversationView({
        messages: conversation.data?.messages ?? EMPTY_MESSAGES,
        decisions,
        orchestratorId: record.id,
        orchestratorName: record.name,
        orchestratorNames: new Map(records.map((r) => [r.id, r.name])),
        now,
      }),
    [conversation.data, decisions, record, records, now],
  );
  const lastId = entries.at(-1)?.id;
  const state = conversationState({
    pending: conversation.isPending || decisionsPending,
    error: conversation.data === undefined && conversation.error !== null,
    status: conversation.data?.status ?? null,
    entryCount: entries.length,
  });

  useEffect(() => {
    const region = scrollRef.current;
    if (region !== null) region.scrollTop = region.scrollHeight;
  }, [
    lastId,
    entries.length,
    state,
    page,
    pane,
    stale,
    actions.sendResult,
    actions.sendFailure,
  ]);

  useEffect(() => {
    if (takeCommentFocus()) focusCommentBox();
  }, [focusPending, takeCommentFocus]);

  return (
    <ConversationPane
      state={state}
      conversationError={{
        message: regionErrorText(
          "Conversation",
          conversation.error?.message ?? "the request failed",
        ),
        onRetry: () => void conversation.refetch(),
      }}
      decisionsError={
        decisionsError === null
          ? null
          : {
              message: regionErrorText("Decisions", decisionsError.message),
              onRetry: refetchDecisions,
            }
      }
      entries={entries}
      stale={stale}
      answering={actions.answering}
      failures={actions.failures}
      onAnswer={actions.onAnswer}
      onOpenTerminal={() => setPane("terminal")}
      scrollRef={scrollRef}
      draft={actions.draft}
      onDraftChange={actions.onDraftChange}
      onSend={actions.onSend}
      sending={actions.sending}
      sendResult={actions.sendResult}
      sendFailure={actions.sendFailure}
    />
  );
}

export function ConversationContainer() {
  const { boardKey, stale, list, record, records } = useCentreSelection();
  if (record === null) {
    if (list.isPending) return <CentreLoading />;
    if (list.data === undefined) return null;
    return <CentreNoMessages />;
  }
  return (
    <ConversationBody
      key={`${boardKey}:${record.id}`}
      boardKey={boardKey}
      stale={stale}
      record={record}
      records={records}
    />
  );
}
