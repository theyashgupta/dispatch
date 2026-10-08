import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  BoardKey,
  BoardList,
  BoardPolicy,
  OrchestratorPolicyOverride,
} from "../../../../shared/types.js";
import {
  boardListKeys,
  boardListQueryOptions,
} from "@/queries/board-list-queries";
import type { ScopeStep } from "@/modules/orchestrator/domain/ownership";
import type { ControlKind } from "@/modules/orchestrator/domain/panel-model";
import {
  addExtraOrchestrator,
  answerDecision,
  ensureOrchestratorTerminal,
  getOpenDecisions,
  getOrchestrators,
  patchScopes,
  resumeLoop,
  runLifecycle,
  saveBoardPolicy,
  saveOverrides,
  sendLoopInput,
  startMain,
  type ExtraInput,
} from "./orchestrator-api.js";

export const PANEL_POLL_MS = 3000;

export const orchestratorKeys = {
  panel: (board: BoardKey) => ["orchestrators", "panel", board] as const,
  decisions: (board: BoardKey) =>
    ["orchestrators", "decisions", board] as const,
};

/**
 * Read the orchestrators of a board for the open panel, refetching every 3 s while it is open.
 *
 * @remarks
 * The query is off while `open` is false, so a board page without the panel makes no
 * orchestrator request. There is no stream event for session state, so the poll is the live feed.
 */
export function orchestratorPanelQueryOptions(board: BoardKey, open: boolean) {
  return queryOptions({
    queryKey: orchestratorKeys.panel(board),
    queryFn: () => getOrchestrators(board),
    enabled: open,
    staleTime: 0,
    refetchInterval: open ? PANEL_POLL_MS : false,
  });
}

/**
 * Read the record of one board from the board list the shell already holds.
 *
 * @remarks
 * `refetchOnMount` is off so the header entry button adds no request of its own.
 */
export function boardRecordQueryOptions(board: BoardKey) {
  return queryOptions({
    ...boardListQueryOptions(),
    refetchOnMount: false,
    select: (list) => list.boards.find((b) => b.key === board) ?? null,
  });
}

/** Read the orchestrators of the open panel and keep them fresh with the 3 s poll. */
export function useOrchestratorPanelQuery(board: BoardKey, open: boolean) {
  return useQuery(orchestratorPanelQueryOptions(board, open));
}

/** Read the board record behind the header entry button from the cached board list. */
export function useBoardRecordQuery(board: BoardKey) {
  return useQuery(boardRecordQueryOptions(board));
}

export interface LifecycleVariables {
  kind: ControlKind;
  id: string;
  hasRecord: boolean;
}

/**
 * Build the mutation options of Start, Stop and Resume.
 *
 * @remarks
 * Start on a board with no record adds the main orchestrator first. Every outcome
 * refreshes the panel and the board list, because a successful add changes the header entry button.
 */
export function lifecycleMutationOptions(
  queryClient: QueryClient,
  board: BoardKey,
) {
  return {
    mutationFn: (vars: LifecycleVariables) =>
      vars.kind === "start"
        ? startMain(board, vars.hasRecord)
        : runLifecycle(board, vars.id, vars.kind),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: orchestratorKeys.panel(board),
        }),
        queryClient.invalidateQueries({ queryKey: boardListKeys.list }),
      ]),
  };
}

/** Run Start, Stop or Resume of the main orchestrator. */
export function useLifecycleMutation(board: BoardKey) {
  return useMutation(lifecycleMutationOptions(useQueryClient(), board));
}

/** Ensure the ttyd terminal of the orchestrator's hidden card. */
export function useEnsureOrchestratorTerminalMutation() {
  return useMutation({
    mutationFn: (cardId: string) => ensureOrchestratorTerminal(cardId),
  });
}

/**
 * Read the open decision items of a board, refetching every 3 s while the panel is open.
 *
 * @remarks
 * A decision item arrives from an orchestrator tool call and no stream event carries it, so the poll is the live feed, as for the panel records.
 */
export function openDecisionsQueryOptions(board: BoardKey) {
  return queryOptions({
    queryKey: orchestratorKeys.decisions(board),
    queryFn: () => getOpenDecisions(board),
    staleTime: 0,
    refetchInterval: PANEL_POLL_MS,
  });
}

/** Read the open decision items of the board of the open panel. */
export function useOpenDecisionsQuery(board: BoardKey) {
  return useQuery(openDecisionsQueryOptions(board));
}

export interface AnswerVariables {
  id: string;
  optionId: string;
  note: string | null;
}

/** Build the mutation options of a decision answer, which refreshes the open decisions after it settles. */
export function answerMutationOptions(
  queryClient: QueryClient,
  board: BoardKey,
) {
  return {
    mutationFn: (vars: AnswerVariables) =>
      answerDecision(vars.id, vars.optionId, vars.note),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: orchestratorKeys.decisions(board),
      }),
  };
}

/** Answer a decision item with an option and an optional typed note. */
export function useAnswerDecisionMutation(board: BoardKey) {
  return useMutation(answerMutationOptions(useQueryClient(), board));
}

/** Build the mutation options of the inline reply to a loop. */
export function replyMutationOptions() {
  return {
    mutationFn: (vars: { cardId: string; text: string }) =>
      sendLoopInput(vars.cardId, vars.text),
  };
}

/** Type a reply into a loop session as the user. */
export function useLoopReplyMutation() {
  return useMutation(replyMutationOptions());
}

/** Build the mutation options of "Resume loop". */
export function resumeLoopMutationOptions() {
  return { mutationFn: (cardId: string) => resumeLoop(cardId) };
}

/** Resume a stopped loop as the user. */
export function useResumeLoopMutation() {
  return useMutation(resumeLoopMutationOptions());
}

/**
 * Build the mutation options of Save policy.
 *
 * @remarks
 * A saved policy replaces the board in the cached board list at once, so the form never shows the old values between the save and the next refetch.
 */
export function savePolicyMutationOptions(
  queryClient: QueryClient,
  board: BoardKey,
) {
  return {
    mutationFn: (policy: BoardPolicy) => saveBoardPolicy(board, policy),
    onSuccess: (outcome: Awaited<ReturnType<typeof saveBoardPolicy>>) => {
      if (!outcome.ok) return;
      queryClient.setQueryData<BoardList>(boardListKeys.list, (list) =>
        list === undefined
          ? list
          : {
              ...list,
              boards: list.boards.map((b) =>
                b.key === board ? outcome.board : b,
              ),
            },
      );
    },
  };
}

/** Save the policy of the board. */
export function useSavePolicyMutation(board: BoardKey) {
  return useMutation(savePolicyMutationOptions(useQueryClient(), board));
}

function refreshRecords(queryClient: QueryClient, board: BoardKey) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: orchestratorKeys.panel(board) }),
    queryClient.invalidateQueries({ queryKey: boardListKeys.list }),
  ]);
}

/** Build the mutation options of "Add orchestrator" in the extra form. */
export function addExtraMutationOptions(
  queryClient: QueryClient,
  board: BoardKey,
) {
  return {
    mutationFn: (input: ExtraInput) => addExtraOrchestrator(board, input),
    onSettled: () => refreshRecords(queryClient, board),
  };
}

/** Add an extra orchestrator. */
export function useAddExtraMutation(board: BoardKey) {
  return useMutation(addExtraMutationOptions(useQueryClient(), board));
}

/** Build the mutation options of "Save overrides". */
export function saveOverridesMutationOptions(
  queryClient: QueryClient,
  board: BoardKey,
) {
  return {
    mutationFn: (vars: {
      id: string;
      policyOverride: OrchestratorPolicyOverride;
    }) => saveOverrides(board, vars.id, vars.policyOverride),
    onSettled: () => refreshRecords(queryClient, board),
  };
}

/** Replace the override of an extra orchestrator. */
export function useSaveOverridesMutation(board: BoardKey) {
  return useMutation(saveOverridesMutationOptions(useQueryClient(), board));
}

/** Build the mutation options of "Move groups", which patches the scopes in order. */
export function moveGroupsMutationOptions(
  queryClient: QueryClient,
  board: BoardKey,
) {
  return {
    mutationFn: (steps: readonly ScopeStep[]) => patchScopes(board, steps),
    onSettled: () => refreshRecords(queryClient, board),
  };
}

/** Move groups between orchestrators. */
export function useMoveGroupsMutation(board: BoardKey) {
  return useMutation(moveGroupsMutationOptions(useQueryClient(), board));
}
