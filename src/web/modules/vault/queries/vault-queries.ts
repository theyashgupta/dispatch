import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  addVaultKey,
  deleteVaultKey,
  editVaultPurpose,
  getVaultKeys,
  getVaultPrevious,
  getVaultValue,
  importFromEnvVault,
  setVaultValue,
} from "./vault-api.js";

export const vaultKeys = {
  all: ["vault"] as const,
  list: ["vault", "list"] as const,
  value: (name: string) => ["vault", "value", name] as const,
  previous: (name: string) => ["vault", "previous", name] as const,
};

/**
 * Read the vault keys fresh on every page open, and drop it once the page closes.
 *
 * @remarks
 * The legacy page read on mount and showed nothing until the read answered; a cached list would show
 * rows that a write made elsewhere (an unwind, an undo, another tab) already removed.
 */
export function vaultKeysQueryOptions() {
  return queryOptions({
    queryKey: vaultKeys.list,
    queryFn: getVaultKeys,
    gcTime: 0,
  });
}

/**
 * Build the query options for a key's current value.
 *
 * @remarks
 * `gcTime: 0` drops the secret from the query cache as soon as no observer is mounted.
 */
export function vaultValueQueryOptions(name: string) {
  return queryOptions({
    queryKey: vaultKeys.value(name),
    queryFn: () => getVaultValue(name),
    gcTime: 0,
    staleTime: 0,
  });
}

/**
 * Build the query options for the value a key held before its latest rotate.
 *
 * @remarks
 * `gcTime: 0` drops the secret from the query cache as soon as no observer is mounted.
 */
export function vaultPreviousQueryOptions(name: string) {
  return queryOptions({
    queryKey: vaultKeys.previous(name),
    queryFn: () => getVaultPrevious(name),
    gcTime: 0,
    staleTime: 0,
  });
}

export function useVaultKeysQuery() {
  return useQuery(vaultKeysQueryOptions());
}

export function useVaultValueQuery(name: string, enabled: boolean) {
  return useQuery({ ...vaultValueQueryOptions(name), enabled });
}

export function useVaultPreviousQuery(name: string, enabled: boolean) {
  return useQuery({ ...vaultPreviousQueryOptions(name), enabled });
}

/**
 * Return a function that drops a key's previous value from the cache.
 *
 * @remarks
 * Hiding the value only disables its query while the row stays mounted, so `gcTime: 0` never fires;
 * the legacy page cleared the value from state on hide.
 */
export function useForgetVaultPrevious() {
  const queryClient = useQueryClient();
  return (name: string) =>
    queryClient.removeQueries({ queryKey: vaultKeys.previous(name) });
}

function invalidateVaultList(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: vaultKeys.list });
}

/**
 * Build the mutation options that create a vault key.
 *
 * @remarks
 * A created key marks the list stale so it reloads. A refusal resolves `{ ok: false, error }` with
 * the server's error code and leaves the cache alone.
 */
export function addVaultKeyMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: addVaultKey,
    onSuccess: (result: Awaited<ReturnType<typeof addVaultKey>>) => {
      if (result.ok) return invalidateVaultList(queryClient);
    },
  };
}

export function useAddVaultKeyMutation() {
  const queryClient = useQueryClient();
  return useMutation(addVaultKeyMutationOptions(queryClient));
}

/**
 * Build the mutation options that set or rotate a key's value.
 *
 * @remarks
 * A saved value marks the list stale so the row shows its new state. A refusal resolves
 * `{ ok: false, error }` and leaves the cache alone.
 */
export function setVaultValueMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (vars: { name: string; value: string }) =>
      setVaultValue(vars.name, vars.value),
    gcTime: 0,
    onSuccess: (result: Awaited<ReturnType<typeof setVaultValue>>) => {
      if (result.ok) return invalidateVaultList(queryClient);
    },
  };
}

export function useSetVaultValueMutation() {
  const queryClient = useQueryClient();
  return useMutation(setVaultValueMutationOptions(queryClient));
}

/**
 * Build the mutation options that edit a key's purpose.
 *
 * @remarks
 * A saved purpose marks the list stale so it reloads. A refusal resolves `{ ok: false, error }`.
 */
export function editVaultPurposeMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (vars: { name: string; purpose: string }) =>
      editVaultPurpose(vars.name, vars.purpose),
    onSuccess: (result: Awaited<ReturnType<typeof editVaultPurpose>>) => {
      if (result.ok) return invalidateVaultList(queryClient);
    },
  };
}

export function useEditVaultPurposeMutation() {
  const queryClient = useQueryClient();
  return useMutation(editVaultPurposeMutationOptions(queryClient));
}

/**
 * Build the mutation options that delete a vault key.
 *
 * @remarks
 * A delete marks the list stale so it reloads. A refused delete resolves `{ ok: false }`.
 */
export function deleteVaultKeyMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: deleteVaultKey,
    onSuccess: (result: Awaited<ReturnType<typeof deleteVaultKey>>) => {
      if (result.ok) return invalidateVaultList(queryClient);
    },
  };
}

export function useDeleteVaultKeyMutation() {
  const queryClient = useQueryClient();
  return useMutation(deleteVaultKeyMutationOptions(queryClient));
}

/**
 * Build the mutation options that import keys from the env vault.
 *
 * @remarks
 * An import marks the list stale so the new keys appear. A refusal resolves `{ ok: false, error }`.
 */
export function importFromEnvVaultMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: importFromEnvVault,
    onSuccess: (result: Awaited<ReturnType<typeof importFromEnvVault>>) => {
      if (result.ok) return invalidateVaultList(queryClient);
    },
  };
}

export function useImportFromEnvVaultMutation() {
  const queryClient = useQueryClient();
  return useMutation(importFromEnvVaultMutationOptions(queryClient));
}
