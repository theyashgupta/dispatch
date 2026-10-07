import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import type { BoardKey, Column } from "../../../../shared/types.js";
import { fetchEvents } from "@/queries/activity-api";
import {
  cleanupCard,
  moveCard,
  openEditor,
  switchSession,
} from "@/queries/cards-api";
import {
  assignCardToMe,
  ensureTerminal,
  getCardComments,
  postCardComment,
  runClaude,
  setCardLinearState,
} from "./detail-api.js";

export const detailKeys = {
  all: ["detail"] as const,
  comments: (
    id: string,
    commentCount: number | undefined,
    lastCommentId: string | undefined,
  ) => ["detail", "card", id, "comments", commentCount, lastCommentId] as const,
  events: (board: BoardKey, id: string) =>
    ["detail", "card", id, "events", board] as const,
};

/**
 * Build the query options for a card's stored Linear comments.
 *
 * @remarks
 * The key carries the comment count and the last comment id because the list is capped at five, so
 * a new comment on a full card leaves the count unchanged. While a new key loads, the previous list
 * shows only when it belongs to the same card; another card's list never shows. Every mount
 * refetches, as the legacy hook did.
 */
export function cardCommentsQueryOptions(
  id: string,
  commentCount: number | undefined,
  lastCommentId: string | undefined,
) {
  return queryOptions({
    queryKey: detailKeys.comments(id, commentCount, lastCommentId),
    queryFn: () => getCardComments(id),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === id ? previous : [],
    staleTime: 0,
  });
}

/**
 * Build the query options for the event backfill of one card's timeline.
 *
 * @remarks Every mount refetches, as the legacy timeline did; a failed read leaves the list empty.
 */
export function cardEventsQueryOptions(board: BoardKey, id: string) {
  return queryOptions({
    queryKey: detailKeys.events(board, id),
    queryFn: () => fetchEvents(board, id),
    staleTime: 0,
  });
}

/** Read a card's stored Linear comments. */
export function useCardCommentsQuery(
  id: string,
  commentCount: number | undefined,
  lastCommentId: string | undefined,
) {
  return useQuery(cardCommentsQueryOptions(id, commentCount, lastCommentId));
}

/** Read the event backfill of one card's timeline. */
export function useCardEventsQuery(board: BoardKey, id: string) {
  return useQuery(cardEventsQueryOptions(board, id));
}

/** Ensure a ttyd terminal for a card's live session. */
export function useEnsureTerminalMutation() {
  return useMutation({ mutationFn: (id: string) => ensureTerminal(id) });
}

/** Relaunch claude inside a card's live shell session. */
export function useRunClaudeMutation() {
  return useMutation({ mutationFn: (id: string) => runClaude(id) });
}

/** Move a card's active pointer to a sibling session. */
export function useSwitchSessionMutation() {
  return useMutation({
    mutationFn: ({
      cardId,
      sessionId,
    }: {
      cardId: string;
      sessionId: string;
    }) => switchSession(cardId, sessionId),
  });
}

/** Open a card's workspace in VS Code or Cursor. */
export function useOpenEditorMutation() {
  return useMutation({
    mutationFn: ({ id, editor }: { id: string; editor: "code" | "cursor" }) =>
      openEditor(id, editor),
  });
}

/**
 * Move a card to a column from the panel header.
 *
 * @remarks A plain request with no optimistic cache write; the board stream carries the result.
 */
export function usePanelMoveCardMutation() {
  return useMutation({
    mutationFn: ({ id, column }: { id: string; column: Column }) =>
      moveCard(id, column),
  });
}

/** Retry a card's workspace cleanup. */
export function useCleanupCardMutation() {
  return useMutation({ mutationFn: (id: string) => cleanupCard(id) });
}

/** Post a Linear comment; a refusal resolves as typed data. */
export function usePostCardCommentMutation() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      postCardComment(id, body),
  });
}

/** Assign a Linear card to the viewer; a refusal resolves as typed data. */
export function useAssignCardToMeMutation() {
  return useMutation({ mutationFn: (id: string) => assignCardToMe(id) });
}

/** Move a Linear card to one of its team's states; a refusal resolves as typed data. */
export function useSetCardLinearStateMutation() {
  return useMutation({
    mutationFn: ({ id, stateId }: { id: string; stateId: string }) =>
      setCardLinearState(id, stateId),
  });
}
