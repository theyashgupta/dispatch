import { useMutation, type UseMutationOptions } from "@tanstack/react-query";
import type { Card, SettableItemState } from "../../shared/types.js";
import { promoteItem, setItemState, snoozeItem } from "./item-actions-api.js";

type Callbacks<TData, TVars> = Pick<
  UseMutationOptions<TData, Error, TVars>,
  "onSuccess" | "onError"
>;

type SnoozeVars = { itemId: string; until: string };

export const promoteItemMutationOptions = {
  mutationFn: (vars: { itemId: string; context?: string }) =>
    promoteItem(vars.itemId, vars.context),
};

export const setItemStateMutationOptions = {
  mutationFn: (vars: { itemId: string; state: SettableItemState }) =>
    setItemState(vars.itemId, vars.state),
};

export const snoozeItemMutationOptions = {
  mutationFn: (vars: SnoozeVars) => snoozeItem(vars.itemId, vars.until),
};

/**
 * Promote an item to an Inbox card, optionally with a context block.
 *
 * @remarks
 * A refusal rejects with the server's reason. Callbacks passed here also run after the caller
 * unmounts, which callbacks passed to `mutate()` do not.
 */
export function usePromoteItemMutation(
  callbacks?: Callbacks<{ card: Card }, { itemId: string; context?: string }>,
) {
  return useMutation({ ...promoteItemMutationOptions, ...callbacks });
}

/** Set an item's state. A refusal rejects with the server's reason. */
export function useSetItemStateMutation() {
  return useMutation(setItemStateMutationOptions);
}

/**
 * Snooze an item until an ISO time.
 *
 * @remarks
 * A refusal rejects with the server's reason. `TVars` lets a caller carry extra variables, such as
 * the preset, into its callbacks.
 */
export function useSnoozeItemMutation<TVars extends SnoozeVars = SnoozeVars>(
  callbacks?: Callbacks<void, TVars>,
) {
  return useMutation<void, Error, TVars>({
    ...snoozeItemMutationOptions,
    ...callbacks,
  });
}
