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
 * Read the update status, re-reading it on every mount.
 *
 * @remarks
 * Settings checks again each time it opens, so a cached read from an earlier visit never stands in
 * for the server's answer.
 */
export function useUpdateStatusQuery() {
  return useQuery({ ...updateStatusQueryOptions(), refetchOnMount: "always" });
}

export const runUpdateMutationOptions = {
  mutationFn: runUpdate,
};

/** Run the update: resolves the legacy `UpdateRunResult` and rejects only on a non-2xx. */
export function useRunUpdateMutation() {
  return useMutation(runUpdateMutationOptions);
}
