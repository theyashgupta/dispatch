import {
  queryOptions,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  ApplyChoice,
  ClaudeAccountsSettings,
  ClaudeLoginView,
} from "../../../../shared/types.js";
import {
  cancelLogin,
  getLoginState,
  refreshAccountUsage,
  removeAccount,
  setActiveAccount,
  setChainOrder,
  setChainSettings,
  setSessionPin,
  startLogin,
  submitLoginCode,
  switchNow,
} from "./accounts-api.js";
import { accountsKeys, accountsQueryOptions } from "@/queries/accounts-queries";

export const LOGIN_POLL_MS = 1_000;

function loginPollInterval(view: ClaudeLoginView | undefined): number | false {
  return view?.state === "done" || view?.state === "error"
    ? false
    : LOGIN_POLL_MS;
}

/**
 * Read the login state, polling every second until the login is done or has failed.
 *
 * @remarks
 * A view that is not yet loaded, idle, starting, awaiting a code or finishing keeps polling. The
 * view is dropped once no dialog reads it, so the next login never opens on an earlier run's view.
 */
export function loginStateQueryOptions() {
  return queryOptions({
    queryKey: accountsKeys.login,
    queryFn: getLoginState,
    refetchInterval: (query) => loginPollInterval(query.state.data),
    refetchIntervalInBackground: true,
    gcTime: 0,
  });
}

export function useAccountsQuery() {
  return useQuery(accountsQueryOptions());
}

/**
 * Read the login state once `enabled` is set.
 *
 * @remarks
 * The add account dialog enables it only after its own start is answered, so a previous run's
 * finished view can never answer first and flash as this run's result.
 */
export function useLoginStateQuery(enabled: boolean) {
  return useQuery({ ...loginStateQueryOptions(), enabled });
}

function invalidateAccounts(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: accountsKeys.list });
}

function invalidateLogin(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: accountsKeys.login });
}

/**
 * Build the mutation options that make an account the active one.
 *
 * @remarks
 * The list is marked stale after the call whether it was accepted or refused, as the header
 * popover always reloaded. A refusal resolves `{ ok: false, error }`. `applyToRunning` rides in the
 * body and a success resolves the moved, queued and skipped counts.
 */
export function setActiveAccountMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (vars: { id: string; applyToRunning: ApplyChoice }) =>
      setActiveAccount(vars.id, vars.applyToRunning),
    onSuccess: () => invalidateAccounts(queryClient),
  };
}

export function useSetActiveAccountMutation() {
  const queryClient = useQueryClient();
  return useMutation(setActiveAccountMutationOptions(queryClient));
}

/**
 * Build the mutation options that fetch an account's usage now.
 *
 * @remarks
 * The list is marked stale after the call whether it was accepted or refused, so a rate-limit
 * refusal still shows the latest snapshot. A refusal resolves `{ ok: false, error }`.
 */
export function refreshAccountUsageMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (id: string) => refreshAccountUsage(id),
    onSuccess: () => invalidateAccounts(queryClient),
  };
}

export function useRefreshAccountUsageMutation() {
  const queryClient = useQueryClient();
  return useMutation(refreshAccountUsageMutationOptions(queryClient));
}

/**
 * Build the mutation options that start a Claude login.
 *
 * @remarks
 * An accepted start marks the login state stale so the poll reads the new run, not an earlier
 * one. A refusal resolves `{ ok: false, error }`, with `inFlight` set when one is already running.
 */
export function startLoginMutationOptions(queryClient: QueryClient) {
  return {
    mutationKey: accountsKeys.start,
    mutationFn: (accountId?: string) => startLogin(accountId),
    onSuccess: (result: Awaited<ReturnType<typeof startLogin>>) => {
      if (result.ok) return invalidateLogin(queryClient);
    },
  };
}

/**
 * Count the login starts still waiting for an answer, every call included.
 *
 * @remarks
 * A component can fire a second start before the first answers (React runs effects twice in
 * development); a per-call callback reports only the latest, so the count comes from the cache.
 */
export function usePendingLoginStarts() {
  return useIsMutating({ mutationKey: accountsKeys.start });
}

export function useStartLoginMutation() {
  const queryClient = useQueryClient();
  return useMutation(startLoginMutationOptions(queryClient));
}

/**
 * Build the mutation options that hand the pasted code to the waiting CLI.
 *
 * @remarks
 * An accepted code marks the login state stale so the next read shows the finishing step. A
 * refusal resolves `{ ok: false, error }` and leaves the cache alone.
 */
export function submitLoginCodeMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (code: string) => submitLoginCode(code),
    gcTime: 0,
    onSuccess: (result: Awaited<ReturnType<typeof submitLoginCode>>) => {
      if (result.ok) return invalidateLogin(queryClient);
    },
  };
}

export function useSubmitLoginCodeMutation() {
  const queryClient = useQueryClient();
  return useMutation(submitLoginCodeMutationOptions(queryClient));
}

/**
 * Build the mutation options that cancel or clear a login.
 *
 * @remarks
 * The login state is marked stale so a later open never shows the cancelled run. The call never
 * rejects: a failure is swallowed.
 */
export function cancelLoginMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: () => cancelLogin(),
    onSuccess: () => invalidateLogin(queryClient),
  };
}

export function useCancelLoginMutation() {
  const queryClient = useQueryClient();
  return useMutation(cancelLoginMutationOptions(queryClient));
}

/**
 * Build the mutation options that remove an added account.
 *
 * @remarks
 * A removal marks the list stale so the account leaves it. A refusal resolves
 * `{ ok: false, error }` and leaves the cache alone.
 */
export function removeAccountMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (id: string) => removeAccount(id),
    onSuccess: (result: Awaited<ReturnType<typeof removeAccount>>) => {
      if (result.ok) return invalidateAccounts(queryClient);
    },
  };
}

export function useRemoveAccountMutation() {
  const queryClient = useQueryClient();
  return useMutation(removeAccountMutationOptions(queryClient));
}

/**
 * Build the mutation options that save the chain order.
 *
 * @remarks
 * The list is marked stale after the call whether it was accepted or refused, so a refusal over a
 * changed account list shows the current order. A refusal resolves `{ ok: false, error }`.
 */
export function setChainOrderMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (order: string[]) => setChainOrder(order),
    onSuccess: () => invalidateAccounts(queryClient),
  };
}

/** Save the chain order and reread the account list after any answer. */
export function useSetChainOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation(setChainOrderMutationOptions(queryClient));
}

/**
 * Build the mutation options that save part of the chain settings.
 *
 * @remarks
 * An accepted save marks the list stale so the chain settings reread. A refusal resolves
 * `{ ok: false, error }` and leaves the cache alone.
 */
export function setChainSettingsMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (patch: Partial<ClaudeAccountsSettings>) =>
      setChainSettings(patch),
    onSuccess: (result: Awaited<ReturnType<typeof setChainSettings>>) => {
      if (result.ok) return invalidateAccounts(queryClient);
    },
  };
}

/** Save part of the chain settings and reread the account list after an accepted save. */
export function useSetChainSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation(setChainSettingsMutationOptions(queryClient));
}

/**
 * Build the mutation options that move to the next eligible account now.
 *
 * @remarks
 * The list is marked stale after the call whether it was accepted or refused. A refusal resolves
 * `{ ok: false, error }`, with a readable line when no account is eligible.
 */
export function switchNowMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: () => switchNow(),
    onSuccess: () => invalidateAccounts(queryClient),
  };
}

/** Move to the next eligible account now and reread the account list after any answer. */
export function useSwitchNowMutation() {
  const queryClient = useQueryClient();
  return useMutation(switchNowMutationOptions(queryClient));
}

/**
 * Build the mutation options that pin a session to its account or release it.
 *
 * @remarks
 * The list carries each session's pin, so it is marked stale after the call whether it was
 * accepted or refused. A refusal resolves `{ ok: false, error }`.
 */
export function setSessionPinMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (vars: {
      cardId: string;
      sessionId: string;
      pinned: boolean;
    }) => setSessionPin(vars.cardId, vars.sessionId, vars.pinned),
    onSuccess: () => invalidateAccounts(queryClient),
  };
}

/** Pin a session to its account or release it, then reread the account list. */
export function useSetSessionPinMutation() {
  const queryClient = useQueryClient();
  return useMutation(setSessionPinMutationOptions(queryClient));
}
