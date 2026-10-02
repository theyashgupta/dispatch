import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  getArchiveRetention,
  saveArchiveRetention,
} from "./archive-retention-api.js";

export const archiveRetentionKeys = {
  all: ["settings", "archive-retention"] as const,
};

export function archiveRetentionQueryOptions() {
  return queryOptions({
    queryKey: archiveRetentionKeys.all,
    queryFn: getArchiveRetention,
  });
}

/**
 * Read the archive retention window, re-reading it on every mount.
 *
 * @remarks
 * Settings shows what the server holds each time it opens, so a cached read from an earlier visit
 * never stands in for it.
 */
export function useArchiveRetentionQuery() {
  return useQuery({
    ...archiveRetentionQueryOptions(),
    refetchOnMount: "always",
  });
}

/**
 * Build the mutation options that save the archive retention window.
 *
 * @remarks
 * An accepted save writes the saved value into the cache. A refusal (400) resolves
 * `{ ok: false }` with the server's message and leaves the cache alone.
 */
export function saveArchiveRetentionMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (days: number) => saveArchiveRetention(days),
    onSuccess: (
      result: Awaited<ReturnType<typeof saveArchiveRetention>>,
      days: number,
    ) => {
      if (result.ok) {
        queryClient.setQueryData(archiveRetentionKeys.all, {
          archiveRetentionDays: days,
        });
      }
    },
  };
}

export function useSaveArchiveRetentionMutation() {
  const queryClient = useQueryClient();
  return useMutation(saveArchiveRetentionMutationOptions(queryClient));
}
