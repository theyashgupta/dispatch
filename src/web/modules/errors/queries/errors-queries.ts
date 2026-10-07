import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { getSentryIssue, resolveSentryIssue } from "./errors-api.js";

export const errorsKeys = {
  all: ["errors"] as const,
  issue: (issueId: string) => ["errors", "issue", issueId] as const,
};

/** Build the query options that read one Sentry issue, refetched on mount once the data is 2 s old. */
export function sentryIssueQueryOptions(issueId: string) {
  return queryOptions({
    queryKey: errorsKeys.issue(issueId),
    queryFn: () => getSentryIssue(issueId),
    staleTime: 2_000,
  });
}

/** Subscribe a container to one Sentry issue detail. */
export function useSentryIssueQuery(issueId: string) {
  return useQuery(sentryIssueQueryOptions(issueId));
}

export const resolveMutationOptions = {
  mutationFn: (vars: { issueId: string }) => resolveSentryIssue(vars.issueId),
};

/**
 * Run the resolve mutation and hand the result to `onResult`.
 *
 * @remarks
 * A refused resolve resolves a failure result, so the callback sits in `onSuccess` and also runs
 * when the user leaves the page before the request settles.
 */
export function useResolveSentryIssueMutation(
  onResult: (result: Awaited<ReturnType<typeof resolveSentryIssue>>) => void,
) {
  return useMutation({ ...resolveMutationOptions, onSuccess: onResult });
}
