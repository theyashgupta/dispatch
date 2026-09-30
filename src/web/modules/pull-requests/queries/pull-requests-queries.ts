import { queryOptions, useQuery } from "@tanstack/react-query";
import { getPullRequest } from "./pull-requests-api.js";

export const pullRequestsKeys = {
  all: ["pull-requests"] as const,
  detail: (owner: string, repo: string, number: number) =>
    ["pull-requests", owner, repo, number] as const,
};

export function pullRequestQueryOptions(
  owner: string,
  repo: string,
  number: number,
) {
  return queryOptions({
    queryKey: pullRequestsKeys.detail(owner, repo, number),
    queryFn: () => getPullRequest(owner, repo, number),
    staleTime: 0,
  });
}

export function usePullRequestQuery(
  owner: string,
  repo: string,
  number: number,
) {
  return useQuery(pullRequestQueryOptions(owner, repo, number));
}
