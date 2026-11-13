import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  DEFAULT_USAGE_THRESHOLDS,
  type UsageThresholds,
} from "../../shared/usage-thresholds.js";
import {
  getUsageThresholds,
  saveUsageThresholds,
} from "./usage-thresholds-api.js";

export const usageThresholdsKeys = {
  all: ["settings", "usage-thresholds"] as const,
};

export function usageThresholdsQueryOptions() {
  return queryOptions({
    queryKey: usageThresholdsKeys.all,
    queryFn: getUsageThresholds,
  });
}

/**
 * Read the usage thresholds for Settings, re-reading them on every mount.
 */
export function useUsageThresholdsQuery() {
  return useQuery({
    ...usageThresholdsQueryOptions(),
    refetchOnMount: "always",
  });
}

/**
 * Read the usage thresholds a usage display colours by, with the defaults until the read lands or when it fails.
 */
export function useUsageThresholds(): UsageThresholds {
  return (
    useQuery(usageThresholdsQueryOptions()).data ?? DEFAULT_USAGE_THRESHOLDS
  );
}

/**
 * Build the mutation options that save the usage thresholds.
 *
 * @remarks
 * An accepted save writes the saved value into the cache, so every usage display recolours at once.
 * A refusal (400) resolves `{ ok: false }` with the server's message and leaves the cache alone.
 */
export function saveUsageThresholdsMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: saveUsageThresholds,
    onSuccess: (
      result: Awaited<ReturnType<typeof saveUsageThresholds>>,
      thresholds: UsageThresholds,
    ) => {
      if (result.ok) {
        queryClient.setQueryData(usageThresholdsKeys.all, thresholds);
      }
    },
  };
}

export function useSaveUsageThresholdsMutation() {
  const queryClient = useQueryClient();
  return useMutation(saveUsageThresholdsMutationOptions(queryClient));
}
