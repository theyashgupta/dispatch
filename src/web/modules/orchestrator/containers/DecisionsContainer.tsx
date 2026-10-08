import { useState } from "react";
import { toast } from "sonner";
import { useRouteContext } from "@tanstack/react-router";
import { DecisionsList } from "@/modules/orchestrator/components/DecisionsList";
import {
  liveReplyResults,
  replyKey,
  type AttentionRow,
  type DecisionView,
  type StoredReply,
} from "@/modules/orchestrator/domain/decision-view";
import {
  actionErrorCopy,
  STALE_REASON,
} from "@/modules/orchestrator/domain/panel-model";
import {
  useAnswerDecisionMutation,
  useLoopReplyMutation,
} from "@/modules/orchestrator/queries/orchestrator-queries";
import type { BoardKey } from "../../../../shared/types.js";

interface DecisionsContainerProps {
  board: BoardKey;
  views: readonly DecisionView[];
  rows: readonly AttentionRow[];
  loading: boolean;
  stale: boolean;
}

export function DecisionsContainer({
  board,
  views,
  rows,
  loading,
  stale,
}: DecisionsContainerProps) {
  const { appStore } = useRouteContext({ from: "__root__" });
  const answer = useAnswerDecisionMutation(board);
  const reply = useLoopReplyMutation();
  const [results, setResults] = useState<Record<string, StoredReply>>({});

  async function onAnswer(
    id: string,
    optionId: string,
    note: string | null,
  ): Promise<boolean> {
    const result = await answer.mutateAsync({ id, optionId, note });
    if (!result.ok) {
      toast.error(actionErrorCopy("Decision answer", result.reason), {
        action: {
          label: "Try again",
          onClick: () => void onAnswer(id, optionId, note),
        },
      });
    }
    return result.ok;
  }

  async function onReply(cardId: string, text: string): Promise<boolean> {
    const row = rows.find((r) => r.cardId === cardId);
    setResults((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([id]) => id !== cardId)),
    );
    const result = await reply.mutateAsync({ cardId, text });
    if (!result.ok) {
      toast.error(actionErrorCopy("Reply", result.reason), {
        action: {
          label: "Try again",
          onClick: () => void onReply(cardId, text),
        },
      });
      return false;
    }
    if (row !== undefined) {
      setResults((prev) => ({
        ...prev,
        [cardId]: { result: result.result, key: replyKey(row) },
      }));
    }
    return result.result === "confirmed";
  }

  return (
    <DecisionsList
      views={views}
      rows={rows}
      results={liveReplyResults(results, rows)}
      loading={loading}
      disabled={stale || answer.isPending || reply.isPending}
      disabledReason={stale ? STALE_REASON : null}
      onAnswer={onAnswer}
      onReply={onReply}
      onOpenTerminal={(cardId) => appStore.selectCard(cardId, null)}
    />
  );
}
