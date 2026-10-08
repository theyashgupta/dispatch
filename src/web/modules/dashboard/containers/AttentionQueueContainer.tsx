import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { buildAttentionQueue } from "../../../../shared/attention-queue.js";
import {
  REPLY_COPY,
  actionFailedText,
  decisionViews,
  liveReplyResults,
  replyKey,
  type StoredReply,
} from "../../../../shared/decision-view.js";
import { AttentionQueueSection } from "@/modules/dashboard/components/AttentionQueueSection";
import {
  ACTIONS_OFF,
  ACTION_LABELS,
  attentionRows,
  replyResultText,
  type AttentionAction,
} from "@/modules/dashboard/domain/attention-rows";
import { sectionState } from "@/modules/dashboard/domain/section-state";
import { useRetryResumeMutation } from "@/modules/dashboard/queries/orchestration-queries";
import {
  useAnswerDecisionMutation,
  useLoopReplyMutation,
  useResumeLoopMutation,
} from "@/queries/attention-actions-queries";
import { retryFailed, useDashboardData } from "./use-dashboard-data";

export function AttentionQueueContainer() {
  const {
    boardKey,
    snapshot,
    summary,
    events,
    decisions,
    accounts,
    orchestrators,
    now,
    connection,
  } = useDashboardData();
  const navigate = useNavigate();
  const answer = useAnswerDecisionMutation(boardKey);
  const reply = useLoopReplyMutation(boardKey);
  const resume = useResumeLoopMutation(boardKey);
  const retryResume = useRetryResumeMutation(boardKey);
  const [replies, setReplies] = useState<Record<string, StoredReply<string>>>(
    {},
  );
  const cards = snapshot.data?.cards;
  const rows = useMemo(() => {
    if (cards === undefined || decisions.data === undefined) return [];
    const items = buildAttentionQueue({
      boardKey,
      cards,
      decisions: decisions.data,
      events: events.data,
      now: new Date(now),
    });
    return attentionRows(items, {
      boardKey,
      cards,
      accounts: accounts.data?.accounts ?? [],
      groups: summary.data?.groups ?? [],
      decisions: decisionViews(
        decisions.data,
        new Map(orchestrators.map((r) => [r.id, r.name])),
        now,
      ),
    });
  }, [
    boardKey,
    cards,
    decisions.data,
    events.data,
    accounts.data,
    summary.data,
    orchestrators,
    now,
  ]);

  const replyResults = liveReplyResults(
    replies,
    rows.filter((row) => row.type === "reply"),
  );

  async function onReply(cardId: string, text: string): Promise<boolean> {
    const row = rows.find((r) => r.type === "reply" && r.cardId === cardId);
    if (row?.type !== "reply") return false;
    const outcome = await reply.mutateAsync({ cardId, text });
    const card = cards?.find((c) => c.id === cardId);
    const resultText = replyResultText(outcome, row.title, card?.state);
    if (resultText === null) {
      if (!outcome.ok) {
        toast.error(actionFailedText("Reply", outcome.reason ?? outcome.error));
      }
    } else {
      setReplies((prev) => ({
        ...prev,
        [cardId]: { key: replyKey(row), result: resultText },
      }));
    }
    return outcome.ok && outcome.result === "confirmed";
  }

  async function onAnswer(
    id: string,
    optionId: string,
    note: string | null,
  ): Promise<boolean> {
    const outcome = await answer.mutateAsync({ id, optionId, note });
    if (!outcome.ok) {
      toast.error(
        actionFailedText("Decision answer", outcome.reason ?? outcome.error),
        {
          action: {
            label: "Try again",
            onClick: () => void onAnswer(id, optionId, note),
          },
        },
      );
    }
    return outcome.ok;
  }

  async function onAction(kind: AttentionAction, cardId: string) {
    const outcome = await (
      kind === "resume" ? resume : retryResume
    ).mutateAsync(cardId);
    if (!outcome.ok) {
      toast.error(
        actionFailedText(ACTION_LABELS[kind], outcome.reason ?? outcome.error),
        {
          action: {
            label: "Try again",
            onClick: () => void onAction(kind, cardId),
          },
        },
      );
    } else if (outcome.result === "unconfirmed") {
      toast.error(REPLY_COPY.unconfirmed);
    }
  }

  const stale = connection === "disconnected";
  return (
    <AttentionQueueSection
      state={sectionState([snapshot, decisions])}
      rows={rows}
      disabled={
        stale ||
        answer.isPending ||
        reply.isPending ||
        resume.isPending ||
        retryResume.isPending
      }
      disabledReason={stale ? ACTIONS_OFF : null}
      replyResults={replyResults}
      onRetry={() => retryFailed([snapshot, decisions])}
      onReply={onReply}
      onAnswer={onAnswer}
      onAction={(kind, cardId) => void onAction(kind, cardId)}
      onOpenTerminal={(cardId) =>
        void navigate({ to: "/board/{-$id}", params: { id: cardId } })
      }
    />
  );
}
