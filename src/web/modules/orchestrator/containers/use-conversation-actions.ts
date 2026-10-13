import { useEffect, useRef, useState } from "react";
import {
  actionFailedText,
  refusalText,
  replyFeedback,
} from "../../../../shared/decision-view.js";
import type { BoardKey } from "../../../../shared/types.js";
import type { RetryFailure } from "@/modules/orchestrator/components/PanelAlertBar";
import { noSessionSendText } from "@/modules/orchestrator/domain/centre-page-state";
import type { OrchestratorView } from "@/modules/orchestrator/domain/panel-model";
import {
  useAnswerDecisionMutation,
  useLoopReplyMutation,
} from "@/queries/attention-actions-queries";

interface AnswerAttempt {
  message: string;
  optionId: string;
  note: string | null;
}

/**
 * Run the comment box send and the decision answers of the conversation pane.
 *
 * @remarks
 * A send reads the newest record, so Try again works after the session starts.
 */
export function useConversationActions(
  board: BoardKey,
  record: OrchestratorView,
  refetchConversation: () => void,
) {
  const answer = useAnswerDecisionMutation(board);
  const reply = useLoopReplyMutation(board);
  const [draft, setDraft] = useState("");
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [sendFailure, setSendFailure] = useState<RetryFailure | null>(null);
  const [attempts, setAttempts] = useState<Record<string, AnswerAttempt>>({});
  const latest = useRef(record);
  useEffect(() => {
    latest.current = record;
  });

  async function onSend(text: string) {
    setSendResult(null);
    setSendFailure(null);
    const onRetry = () => void onSend(text);
    const record = latest.current;
    if (record.cardId === null) {
      setSendFailure({ message: noSessionSendText(record.name), onRetry });
      return;
    }
    const outcome = await reply.mutateAsync({ cardId: record.cardId, text });
    const { result, failure } = replyFeedback(
      outcome,
      record.name,
      record.session?.state ?? undefined,
      "Message",
    );
    setSendResult(result);
    if (failure !== null) setSendFailure({ message: failure, onRetry });
    if (outcome.ok && outcome.result === "confirmed") {
      setDraft((current) => (current.trim() === text ? "" : current));
    }
    refetchConversation();
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
      const message = actionFailedText(
        "Decision answer",
        refusalText(result.error, result.reason),
      );
      setAttempts((prev) => ({ ...prev, [id]: { message, optionId, note } }));
    }
    return result.ok;
  }

  const failures: Record<string, RetryFailure> = Object.fromEntries(
    Object.entries(attempts).map(([id, a]) => [
      id,
      {
        message: a.message,
        onRetry: () => void onAnswer(id, a.optionId, a.note),
      },
    ]),
  );

  return {
    draft,
    onDraftChange: (text: string) => {
      setDraft(text);
      setSendResult(null);
    },
    onSend: () => void onSend(draft.trim()),
    sending: reply.isPending,
    sendResult,
    sendFailure,
    answering: answer.isPending,
    failures,
    onAnswer,
  };
}
