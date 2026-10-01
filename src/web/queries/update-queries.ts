import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { getUpdateStatus, runUpdate } from "./update-api.js";

export const updateKeys = {
  all: ["update"] as const,
  status: ["update", "status"] as const,
};

export function updateStatusQueryOptions() {
  return queryOptions({
    queryKey: updateKeys.status,
    queryFn: getUpdateStatus,
  });
}

/**
 * Read the update status.
 */
export function useUpdateStatusQuery() {
  return useQuery(updateStatusQueryOptions());
}

export const runUpdateMutationOptions = {
  mutationFn: runUpdate,
};

/** Run the update: resolves the legacy `UpdateRunResult` and rejects only on a non-2xx. */
export function useRunUpdateMutation() {
  return useMutation(runUpdateMutationOptions);
}
