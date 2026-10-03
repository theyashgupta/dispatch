import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { SourceConnection } from "../../shared/types.js";
import {
  connectSource,
  deleteSourceKey,
  disableSource,
  getSourceConnection,
  saveSourceKey,
} from "./source-connection-api.js";

export const sourceConnectionKeys = {
  all: ["connections"] as const,
  detail: (source: string) => ["connections", "source", source] as const,
};

export function sourceConnectionQueryOptions(source: string) {
  return queryOptions({
    queryKey: sourceConnectionKeys.detail(source),
    queryFn: () => getSourceConnection(source),
  });
}

/**
 * Read one source's connection, re-reading it on every mount.
 *
 * @remarks
 * A card shows the connection as the server reports it now, so a cached read from an earlier
 * visit never stands in for it.
 */
export function useSourceConnectionQuery(source: string) {
  return useQuery({
    ...sourceConnectionQueryOptions(source),
    refetchOnMount: "always",
  });
}

function reread(queryClient: QueryClient, source: string): Promise<void> {
  return queryClient.refetchQueries({
    queryKey: sourceConnectionKeys.detail(source),
    exact: true,
  });
}

/**
 * Build the mutation options that store a new key for a source.
 *
 * @remarks
 * A saved key writes a connected connection into the cache and then re-reads it. A refused key
 * re-reads only when a disconnect won the race or the save failed, so the card shows what the
 * server holds.
 */
export function saveSourceKeyMutationOptions(
  queryClient: QueryClient,
  source: string,
) {
  return {
    mutationFn: (apiKey: string) => saveSourceKey(source, apiKey),
    gcTime: 0,
    onSuccess: async (result: Awaited<ReturnType<typeof saveSourceKey>>) => {
      if (result.ok) {
        const connection: SourceConnection = {
          configured: true,
          connected: true,
          enabled: true,
          ...(result.account ? { account: result.account } : {}),
        };
        queryClient.setQueryData(
          sourceConnectionKeys.detail(source),
          connection,
        );
        await reread(queryClient, source);
        return;
      }
      if (result.reason === "superseded" || result.reason === "failed") {
        await reread(queryClient, source);
      }
    },
  };
}

export function useSaveSourceKeyMutation(source: string) {
  const queryClient = useQueryClient();
  return useMutation(saveSourceKeyMutationOptions(queryClient, source));
}

/**
 * Build the mutation options that turn a source on with the credential it already has.
 *
 * @remarks
 * Only an accepted connect re-reads. A refusal changed nothing on the server.
 */
export function connectSourceMutationOptions(
  queryClient: QueryClient,
  source: string,
) {
  return {
    mutationFn: () => connectSource(source),
    onSuccess: async (result: Awaited<ReturnType<typeof connectSource>>) => {
      if (result.ok) await reread(queryClient, source);
    },
  };
}

export function useConnectSourceMutation(source: string) {
  const queryClient = useQueryClient();
  return useMutation(connectSourceMutationOptions(queryClient, source));
}

/**
 * Build the mutation options that pause a source and keep its token.
 *
 * @remarks
 * The connection is re-read whether the request worked or not, so the card shows what the server
 * holds.
 */
export function disableSourceMutationOptions(
  queryClient: QueryClient,
  source: string,
) {
  return {
    mutationFn: () => disableSource(source),
    onSettled: () => reread(queryClient, source),
  };
}

export function useDisableSourceMutation(source: string) {
  const queryClient = useQueryClient();
  return useMutation(disableSourceMutationOptions(queryClient, source));
}

/**
 * Build the mutation options that remove a source's stored key.
 *
 * @remarks
 * A removed key writes a bare disconnected connection into the cache and then re-reads it. A failed
 * delete re-reads and rethrows, so the card shows the failure beside the real state.
 */
export function deleteSourceKeyMutationOptions(
  queryClient: QueryClient,
  source: string,
) {
  return {
    mutationFn: () => deleteSourceKey(source),
    onSuccess: async () => {
      const connection: SourceConnection = {
        configured: false,
        connected: false,
      };
      queryClient.setQueryData(sourceConnectionKeys.detail(source), connection);
      await reread(queryClient, source);
    },
    onError: () => reread(queryClient, source),
  };
}

export function useDeleteSourceKeyMutation(source: string) {
  const queryClient = useQueryClient();
  return useMutation(deleteSourceKeyMutationOptions(queryClient, source));
}
