import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { activeSessionView } from "../../../../shared/active-session.js";
import {
  REPLY_COPY,
  actionFailedText,
  refusalText,
} from "../../../../shared/decision-view.js";
import type { BoardKey, Card } from "../../../../shared/types.js";
import type { TileFeedback } from "@/modules/orchestrator/components/BranchTile";
import type { CentreBranch } from "@/modules/orchestrator/domain/centre-graph";
import {
  ACTION_LABELS,
  replyOutcomeText,
} from "@/modules/orchestrator/domain/centre-page-state";
import {
  useLoopReplyMutation,
  useResumeLoopMutation,
  useRetryResumeMutation,
} from "@/queries/attention-actions-queries";

type ResumeKind = "resume" | "retry_resume";

interface Stored {
  result: string | null;
  since: string | null;
  failure: string | null;
  retry: (() => void) | null;
}

const NONE: TileFeedback = { result: null, failure: null };

/**
 * Run the inline actions of the branch tiles and keep the result or the failure line of each tile.
 *
 * @remarks A result belongs to the state it answered: it hides once the branch has a new `stateSince`, so a stored "Delivered" never labels a question nobody answered.
 */
export function useBranchActions(board: BoardKey, cards: readonly Card[]) {
  const navigate = useNavigate();
  const reply = useLoopReplyMutation(board);
  const resume = useResumeLoopMutation(board);
  const retryResume = useRetryResumeMutation(board);
  const [stored, setStored] = useState<Record<string, Stored>>({});

  const remember = (id: string, value: Stored) =>
    setStored((prev) => ({ ...prev, [id]: value }));

  async function onReply(branch: CentreBranch, text: string) {
    const cardId = branch.cardId;
    if (cardId === null) return false;
    const outcome = await reply.mutateAsync({ cardId, text });
    const card = cards.find((c) => c.id === cardId);
    const result = replyOutcomeText(
      outcome,
      branch.identifier ?? cardId,
      card === undefined ? undefined : activeSessionView(card)?.state,
    );
    remember(branch.id, {
      result,
      since: branch.stateSince,
      failure:
        outcome.ok || result !== null
          ? null
          : actionFailedText(
              "Reply",
              refusalText(outcome.error, outcome.reason),
            ),
      retry: () => void onReply(branch, text),
    });
    return outcome.ok && outcome.result === "confirmed";
  }

  async function onAction(branch: CentreBranch, kind: ResumeKind) {
    const cardId = branch.cardId;
    if (cardId === null) return;
    const outcome = await (
      kind === "resume" ? resume : retryResume
    ).mutateAsync(cardId);
    remember(branch.id, {
      result:
        outcome.ok && outcome.result === "unconfirmed"
          ? REPLY_COPY.unconfirmed
          : null,
      since: branch.stateSince,
      failure: outcome.ok
        ? null
        : actionFailedText(
            ACTION_LABELS[kind],
            refusalText(outcome.error, outcome.reason),
          ),
      retry: () => void onAction(branch, kind),
    });
  }

  return {
    pending: reply.isPending || resume.isPending || retryResume.isPending,
    feedback: (branch: CentreBranch): TileFeedback => {
      const entry = stored[branch.id];
      if (entry === undefined) return NONE;
      return {
        result: entry.since === branch.stateSince ? entry.result : null,
        failure: entry.failure,
      };
    },
    onReply,
    onAction: (branch: CentreBranch, kind: ResumeKind) =>
      void onAction(branch, kind),
    onRetry: (branch: CentreBranch) => stored[branch.id]?.retry?.(),
    onOpenTerminal: () =>
      void navigate({ to: "/boards/$key", params: { key: board } }),
  };
}
