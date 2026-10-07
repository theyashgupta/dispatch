import {
  queryOptions,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { MeetingSourceConfig } from "../../shared/types.js";
import {
  checkGranola,
  getGranola,
  putGranola,
  runGranola,
} from "./granola-api.js";

export const granolaKeys = {
  status: ["meetings", "granola"] as const,
};

export function granolaQueryOptions() {
  return queryOptions({
    queryKey: granolaKeys.status,
    queryFn: getGranola,
  });
}

/**
 * Build the mutation options that save Granola settings.
 *
 * @remarks
 * The mutation cancels any in-flight status read first, so a slow poll cannot bring back an older
 * status after the save answered. A failed save re-reads the status instead of keeping a guess.
 */
export function putGranolaMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (patch: MeetingSourceConfig) => putGranola(patch),
    onMutate: () => queryClient.cancelQueries({ queryKey: granolaKeys.status }),
    onSuccess: (status: Awaited<ReturnType<typeof putGranola>>) => {
      queryClient.setQueryData(granolaKeys.status, status);
    },
    onError: () =>
      queryClient.invalidateQueries({ queryKey: granolaKeys.status }),
  };
}

export function usePutGranolaMutation() {
  const queryClient = useQueryClient();
  return useMutation(putGranolaMutationOptions(queryClient));
}

export const checkGranolaMutationOptions = {
  mutationFn: checkGranola,
};

export function useCheckGranolaMutation() {
  return useMutation(checkGranolaMutationOptions);
}

/**
 * Build the mutation options that start a Granola round now.
 *
 * @remarks
 * A refused run (running or off) needs no message of its own, so the mutation always re-reads the
 * status, which then shows the round running or the card Off.
 */
export function runGranolaMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: () => runGranola().catch(() => undefined),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: granolaKeys.status }),
  };
}

export function useRunGranolaMutation() {
  const queryClient = useQueryClient();
  return useMutation(runGranolaMutationOptions(queryClient));
}
