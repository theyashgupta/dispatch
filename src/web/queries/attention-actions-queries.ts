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
  getAnsweredDecisions,
  getOpenDecisions,
  resumeLoop,
  retryResume,
  sendLoopInput,
} from "./attention-actions-api.js";

/** The query key prefix of every orchestration read of a board. */
export function orchestrationKey(board: string) {
  return ["orchestration", board] as const;
}

export const attentionActionsKeys = {
  decisions: (board: BoardKey) =>
    [...orchestrationKey(board), "decisions"] as const,
  answered: (board: BoardKey) =>
    [...orchestrationKey(board), "decisions", "answered"] as const,
};

const DECISIONS_POLL_MS = 3000;

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

/**
 * Build the answered decisions query options of the command centre: the answered decisions, refetched every 3 s.
 *
 * @remarks
 * The graph reads the approved plan from an answered item, and an answer arrives from the orchestrator side with no stream event, so the poll is the live feed, as for the open decisions.
 */
export function answeredDecisionsQueryOptions(board: BoardKey) {
  return queryOptions({
    queryKey: attentionActionsKeys.answered(board),
    queryFn: () => getAnsweredDecisions(board),
    staleTime: 0,
    refetchInterval: DECISIONS_POLL_MS,
  });
}

export function useAnsweredDecisionsQuery(board: BoardKey) {
  return useQuery(answeredDecisionsQueryOptions(board));
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

export function retryResumeMutationOptions(
  queryClient: QueryClient,
  board: BoardKey,
) {
  return {
    mutationFn: (cardId: string) => retryResume(cardId),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: orchestrationKey(board) }),
  };
}

export function useRetryResumeMutation(board: BoardKey) {
  return useMutation(retryResumeMutationOptions(useQueryClient(), board));
}
