import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { activeSessionView } from "../../../../shared/active-session.js";
import {
  ACTION_LABELS,
  REPLY_COPY,
  actionFailedText,
  refusalText,
  replyFeedback,
} from "../../../../shared/decision-view.js";
import type { BoardKey, Card } from "../../../../shared/types.js";
import type { TileFeedback } from "@/modules/orchestrator/components/BranchTile";
import type { CentreBranch } from "@/modules/orchestrator/domain/centre-graph";
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
 * Run the inline actions of the branch tiles and keep the result, the failure line and the reply draft of each tile.
 *
 * @remarks A result or a failure belongs to the state it answered: it hides once the branch has a new `stateSince`, so a stored "Delivered" never labels a question nobody answered. The draft lives here so a tile that remounts on a band change or a tab switch keeps it.
 */
export function useBranchActions(board: BoardKey, cards: readonly Card[]) {
  const navigate = useNavigate();
  const reply = useLoopReplyMutation(board);
  const resume = useResumeLoopMutation(board);
  const retryResume = useRetryResumeMutation(board);
  const [stored, setStored] = useState<Record<string, Stored>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const remember = (id: string, value: Stored) =>
    setStored((prev) => ({ ...prev, [id]: value }));

  async function onReply(branch: CentreBranch, text: string) {
    const cardId = branch.cardId;
    if (cardId === null) return;
    const outcome = await reply.mutateAsync({ cardId, text });
    const card = cards.find((c) => c.id === cardId);
    const { result, failure } = replyFeedback(
      outcome,
      branch.identifier ?? cardId,
      card === undefined ? undefined : activeSessionView(card)?.state,
      "Reply",
    );
    remember(branch.id, {
      result,
      since: branch.stateSince,
      failure,
      retry: () => void onReply(branch, text),
    });
    if (outcome.ok && outcome.result === "confirmed") {
      setDrafts((prev) =>
        prev[branch.id]?.trim() === text ? { ...prev, [branch.id]: "" } : prev,
      );
    }
  }

  async function onAction(branch: CentreBranch, kind: ResumeKind) {
    const cardId = branch.cardId;
    if (cardId === null) return;
    const outcome = await (
      kind === "resume" ? resume : retryResume
    ).mutateAsync(cardId);
    remember(branch.id, {
      result: outcome.ok ? REPLY_COPY[outcome.result ?? "unconfirmed"] : null,
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
      const current = entry.since === branch.stateSince;
      return {
        result: current ? entry.result : null,
        failure: current ? entry.failure : null,
      };
    },
    draftOf: (branch: CentreBranch) => drafts[branch.id] ?? "",
    setDraft: (branch: CentreBranch, text: string) =>
      setDrafts((prev) => ({ ...prev, [branch.id]: text })),
    onReply,
    onAction: (branch: CentreBranch, kind: ResumeKind) =>
      void onAction(branch, kind),
    onRetry: (branch: CentreBranch) => stored[branch.id]?.retry?.(),
    onOpenTerminal: () =>
      void navigate({ to: "/boards/$key", params: { key: board } }),
  };
}
