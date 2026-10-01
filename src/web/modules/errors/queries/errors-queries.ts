import { queryOptions, useQuery } from "@tanstack/react-query";
import { getSentryIssue } from "./errors-api.js";

export const errorsKeys = {
  all: ["errors"] as const,
  issue: (issueId: string) => ["errors", "issue", issueId] as const,
};

export function sentryIssueQueryOptions(issueId: string) {
  return queryOptions({
    queryKey: errorsKeys.issue(issueId),
    queryFn: () => getSentryIssue(issueId),
    staleTime: 0,
  });
}

export function useSentryIssueQuery(issueId: string) {
  return useQuery(sentryIssueQueryOptions(issueId));
}
