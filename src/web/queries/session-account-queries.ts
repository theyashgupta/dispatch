import { useState } from "react";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  MOVE_FAILED_NOTE,
  moveNote,
  type SessionNote,
} from "../../shared/session-account-view.js";
import { moveSessionAccount } from "./session-account-api.js";
import { useSingleFlight } from "./single-flight.js";

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

/**
 * Move sessions onto accounts one at a time and keep each session's result note.
 *
 * @remarks
 * Notes are keyed by session, so a result never lands on another card or session. A move started
 * while another is in flight is dropped and leaves `pending` on the first one.
 */
export function useSessionAccountMove() {
  const mutation = useMoveSessionAccountMutation();
  const moveOnce = useSingleFlight(mutation.mutate);
  const [notes, setNotes] = useState<Record<string, SessionNote>>({});
  const [pending, setPending] = useState<{
    key: string;
    kind: "restart" | "continue";
  } | null>(null);

  const move = (
    key: string,
    kind: "restart" | "continue",
    vars: MoveSessionAccountVars,
    movedText: string,
  ) => {
    setPending((current) => current ?? { key, kind });
    const note = (next: SessionNote) =>
      setNotes((prev) => ({ ...prev, [key]: next }));
    moveOnce(vars, {
      onSuccess: (result) => note(moveNote(result, movedText)),
      onError: () => note(MOVE_FAILED_NOTE),
      onSettled: () => setPending(null),
    });
  };

  return { notes, pending, move };
}
