import { useMutation } from "@tanstack/react-query";
import type { SettableItemState } from "../../../../shared/types.js";
import { promoteItem, setItemState, snoozeItem } from "./inbox-api.js";

export const inboxKeys = {
  all: ["inbox"] as const,
};

interface SetItemStateVariables {
  id: string;
  state: SettableItemState;
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

/** Build the mutation options that snooze an item until an ISO time. */
export function snoozeItemMutationOptions() {
  return {
    mutationFn: ({ id, until }: SnoozeItemVariables) => snoozeItem(id, until),
  };
}

/** Build the mutation options that promote an item to a local Inbox card. */
export function promoteItemMutationOptions() {
  return {
    mutationFn: ({ id, context }: PromoteItemVariables) =>
      promoteItem(id, context),
  };
}

export function useSetItemStateMutation() {
  return useMutation(setItemStateMutationOptions());
}

export function useSnoozeItemMutation() {
  return useMutation(snoozeItemMutationOptions());
}

export function usePromoteItemMutation() {
  return useMutation(promoteItemMutationOptions());
}
