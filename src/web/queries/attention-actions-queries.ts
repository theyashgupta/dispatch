import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { BoardKey } from "../../shared/types.js";
import {
  answerDecision,
  getOpenDecisions,
  resumeLoop,
  sendLoopInput,
} from "./attention-actions-api.js";

/** The query key prefix of every orchestration read of a board. */
export function orchestrationKey(board: string) {
  return ["orchestration", board] as const;
}

export const attentionActionsKeys = {
  decisions: (board: BoardKey) =>
    [...orchestrationKey(board), "decisions"] as const,
};

export interface AnswerVariables {
  id: string;
  optionId: string;
  note: string | null;
}

export function openDecisionsQueryOptions(board: BoardKey) {
  return queryOptions({
    queryKey: attentionActionsKeys.decisions(board),
    queryFn: () => getOpenDecisions(board),
  });
}

export function useOpenDecisionsQuery(board: BoardKey) {
  return useQuery(openDecisionsQueryOptions(board));
}

/** Build the mutation options of a decision answer, which refreshes the open decisions after it settles. */
export function answerDecisionMutationOptions(
  queryClient: QueryClient,
  board: BoardKey,
) {
  return {
    mutationFn: (vars: AnswerVariables) =>
      answerDecision(vars.id, vars.optionId, vars.note),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: attentionActionsKeys.decisions(board),
      }),
  };
}

export function useAnswerDecisionMutation(board: BoardKey) {
  return useMutation(answerDecisionMutationOptions(useQueryClient(), board));
}

export function loopReplyMutationOptions(
  queryClient: QueryClient,
  board: BoardKey,
) {
  return {
    mutationFn: (vars: { cardId: string; text: string }) =>
      sendLoopInput(vars.cardId, vars.text),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: orchestrationKey(board) }),
  };
}

export function useLoopReplyMutation(board: BoardKey) {
  return useMutation(loopReplyMutationOptions(useQueryClient(), board));
}

export function resumeLoopMutationOptions(
  queryClient: QueryClient,
  board: BoardKey,
) {
  return {
    mutationFn: (cardId: string) => resumeLoop(cardId),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: orchestrationKey(board) }),
  };
}

export function useResumeLoopMutation(board: BoardKey) {
  return useMutation(resumeLoopMutationOptions(useQueryClient(), board));
}
