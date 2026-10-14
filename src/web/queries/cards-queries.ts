import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { BoardKey } from "../../shared/types.js";
import {
  createLocalTicket,
  generateGroupTitle,
  generateTicketDraft,
  getResumeTarget,
  pauseCard,
  resumeCard,
  startCard,
  startGroup,
  syncCardToLinear,
  unpauseCard,
} from "./cards-api.js";

interface SyncCardToLinearVariables {
  id: string;
  teamId: string;
  stateId?: string;
}

interface GenerateTicketDraftVariables {
  direction: string;
  signal: AbortSignal;
  images?: readonly string[];
}

interface CreateLocalTicketVariables {
  title: string;
  description: string;
  images?: readonly string[];
}

interface StartCardVariables {
  id: string;
  extraDirection: string;
  folder?: string;
  repos?: { path: string; base: string }[];
  playbook?: string;
  newSession?: boolean;
  inheritFrom?: string;
}

interface StartGroupVariables {
  title: string;
  memberIds: string[];
  folder: string;
  repos: { path: string; base: string }[];
  playbook?: string;
  extraDirection?: string;
}

interface CardIdVariables {
  id: string;
}

interface GenerateGroupTitleVariables {
  memberIds: string[];
  signal: AbortSignal;
}

/**
 * Build the mutation options that promote a local card to a Linear issue.
 *
 * @remarks A 400 and a 409 resolve as data with the server copy; the card update arrives over the board stream, so no cache is written.
 */
export function syncCardToLinearMutationOptions() {
  return {
    mutationFn: ({ id, teamId, stateId }: SyncCardToLinearVariables) =>
      syncCardToLinear(id, { teamId, ...(stateId ? { stateId } : {}) }),
  };
}

/**
 * Build the mutation options that draft a ticket from a direction.
 *
 * @remarks A refusal resolves `{ ok: false }`; an abort or network failure rejects so the caller can tell a user abort from the rest.
 */
export function generateTicketDraftMutationOptions() {
  return {
    gcTime: 0,
    mutationFn: ({ direction, signal, images }: GenerateTicketDraftVariables) =>
      generateTicketDraft(direction, signal, images),
  };
}

/** Build the mutation options that persist a reviewed ticket draft as a local card. */
export function createLocalTicketMutationOptions(board: BoardKey) {
  return {
    gcTime: 0,
    mutationFn: ({ title, description, images }: CreateLocalTicketVariables) =>
      createLocalTicket(board, title, description, images),
  };
}

export function useSyncCardToLinearMutation() {
  return useMutation(syncCardToLinearMutationOptions());
}

export function useGenerateTicketDraftMutation() {
  return useMutation(generateTicketDraftMutationOptions());
}

export function useCreateLocalTicketMutation(board: BoardKey) {
  return useMutation(createLocalTicketMutationOptions(board));
}

/**
 * Build the mutation options that start a card's session.
 *
 * @remarks A 400 resolves `{ ok: false }` with its error and variant; any other status rejects. The card update arrives over the board stream, so no cache is written.
 */
export function startCardMutationOptions() {
  return {
    mutationFn: ({
      id,
      extraDirection,
      folder,
      repos,
      playbook,
      newSession,
      inheritFrom,
    }: StartCardVariables) =>
      startCard(
        id,
        extraDirection,
        folder,
        repos,
        playbook,
        newSession,
        inheritFrom,
      ),
  };
}

/**
 * Build the mutation options that create and start a group.
 *
 * @remarks A 400 and a 409 resolve `{ ok: false }` with the server's variant and the ineligible ids; any other status rejects.
 */
export function startGroupMutationOptions(board: BoardKey) {
  return {
    mutationFn: (input: StartGroupVariables) => startGroup(board, input),
  };
}

/**
 * Build the mutation options that generate a group title phrase.
 *
 * @remarks A refusal resolves `{ ok: false }`; an abort or network failure rejects so the caller can tell a user abort from the rest.
 */
export function generateGroupTitleMutationOptions() {
  return {
    mutationFn: ({ memberIds, signal }: GenerateGroupTitleVariables) =>
      generateGroupTitle(memberIds, signal),
  };
}

export function useStartCardMutation() {
  return useMutation(startCardMutationOptions());
}

export function useStartGroupMutation(board: BoardKey) {
  return useMutation(startGroupMutationOptions(board));
}

export function useGenerateGroupTitleMutation() {
  return useMutation(generateGroupTitleMutationOptions());
}

/**
 * Build the mutation options that resume a dead In Review session.
 *
 * @remarks
 * A non-2xx resolves `{ ok: false, status }` and a network failure resolves
 * `{ ok: false, status: null }`, so the caller can tell a 409 from the rest. The card update
 * arrives over the board stream, so no cache is written.
 */
export function resumeCardMutationOptions() {
  return {
    mutationFn: ({ id }: CardIdVariables) => resumeCard(id),
  };
}

export const cardsKeys = {
  resumeTarget: (id: string) => ["cards", id, "resume-target"] as const,
};

/**
 * Build the query options that read which conversation Resume will open.
 *
 * @remarks
 * `enabled` is false while the Resume button is hidden, so the folder is read only when needed.
 */
export function resumeTargetQueryOptions(id: string, enabled = true) {
  return queryOptions({
    queryKey: cardsKeys.resumeTarget(id),
    queryFn: () => getResumeTarget(id),
    enabled,
  });
}

/** Read which conversation Resume will open for a card, only while `enabled`. */
export function useResumeTargetQuery(id: string, enabled: boolean) {
  return useQuery(resumeTargetQueryOptions(id, enabled));
}

/** Resume a dead In Review session, then drop the cached resume target. */
export function useResumeCardMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    ...resumeCardMutationOptions(),
    onSuccess: (_result, { id }) =>
      queryClient.invalidateQueries({ queryKey: cardsKeys.resumeTarget(id) }),
  });
}

function pauseCardMutationOptions() {
  return {
    mutationFn: ({ id }: CardIdVariables) => pauseCard(id),
  };
}

function unpauseCardMutationOptions() {
  return {
    mutationFn: ({ id }: CardIdVariables) => unpauseCard(id),
  };
}

/** Pause a loop card; the card update arrives over the board stream, so no cache is written. */
export function usePauseCardMutation() {
  return useMutation(pauseCardMutationOptions());
}

/** Unpause a paused loop card; the card update arrives over the board stream, so no cache is written. */
export function useUnpauseCardMutation() {
  return useMutation(unpauseCardMutationOptions());
}
