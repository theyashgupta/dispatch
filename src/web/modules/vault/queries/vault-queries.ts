import { queryOptions, useQuery } from "@tanstack/react-query";
import { getVaultKeys, getVaultPrevious, getVaultValue } from "./vault-api.js";

export const vaultKeys = {
  all: ["vault"] as const,
  list: ["vault", "list"] as const,
  value: (name: string) => ["vault", "value", name] as const,
  previous: (name: string) => ["vault", "previous", name] as const,
};

export function vaultKeysQueryOptions() {
  return queryOptions({
    queryKey: vaultKeys.list,
    queryFn: getVaultKeys,
  });
}

/**
 * Query options for a key's current value.
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
 * Query options for the value a key held before its latest rotate.
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
