import { useMutation } from "@tanstack/react-query";
import type { BoardKey, SettableItemState } from "../../../../shared/types.js";
import { setCardInboxDismissed } from "@/queries/cards-api";
import {
  promoteItem,
  setItemState,
  snoozeItem,
} from "@/queries/item-actions-api";

interface SetItemStateVariables {
  id: string;
  state: SettableItemState;
}

interface SetCardInboxDismissedVariables {
  id: string;
  dismissed: boolean;
}

interface SnoozeItemVariables {
  id: string;
  until: string;
}

interface PromoteItemVariables {
  id: string;
  context?: string;
}

/**
 * Build the mutation options that set an item's state.
 *
 * @remarks The inbox rows come from the board stream, so the mutation writes no cache; the next frame carries the change.
 */
export function setItemStateMutationOptions() {
  return {
    mutationFn: ({ id, state }: SetItemStateVariables) =>
      setItemState(id, state),
  };
}

/**
 * Build the mutation options that set or clear a card's Inbox dismissal.
 *
 * @remarks Like the item state mutation, it writes no cache; the next board frame carries the change.
 */
export function setCardInboxDismissedMutationOptions() {
  return {
    mutationFn: ({ id, dismissed }: SetCardInboxDismissedVariables) =>
      setCardInboxDismissed(id, dismissed),
  };
}

/** Build the mutation options that snooze an item until an ISO time. */
export function snoozeItemMutationOptions() {
  return {
    mutationFn: ({ id, until }: SnoozeItemVariables) => snoozeItem(id, until),
  };
}

/** Build the mutation options that promote an item to a local Inbox card. */
export function promoteItemMutationOptions(board: BoardKey) {
  return {
    mutationFn: ({ id, context }: PromoteItemVariables) =>
      promoteItem(board, id, context),
  };
}

export function useSetItemStateMutation() {
  return useMutation(setItemStateMutationOptions());
}

/** Dismiss or restore a Linear Inbox card, moving it out of or back into the waiting list. */
export function useSetCardInboxDismissedMutation() {
  return useMutation(setCardInboxDismissedMutationOptions());
}

export function useSnoozeItemMutation() {
  return useMutation(snoozeItemMutationOptions());
}

export function usePromoteItemMutation(board: BoardKey) {
  return useMutation(promoteItemMutationOptions(board));
}
