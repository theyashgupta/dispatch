import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { moveSessionAccount } from "./session-account-api.js";

const ACCOUNTS_KEY = ["accounts"] as const;

interface MoveSessionAccountVars {
  cardId: string;
  accountId: string;
  sessionId?: string;
}

/**
 * Build the mutation options that move a session onto an account.
 *
 * @remarks
 * The accounts list carries each session's account and turn, so it is marked stale after the call
 * settles, whether it was accepted or refused. A refusal resolves `{ ok: false, error, message }`.
 */
export function moveSessionAccountMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (vars: MoveSessionAccountVars) =>
      moveSessionAccount(vars.cardId, vars.accountId, vars.sessionId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
  };
}

/** Move a session onto an account. */
export function useMoveSessionAccountMutation() {
  const queryClient = useQueryClient();
  return useMutation(moveSessionAccountMutationOptions(queryClient));
}
