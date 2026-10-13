import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { BoardKey, PrReviewEvent } from "../../../../shared/types.js";
import {
  getGithubRepos,
  getPullRequest,
  mergePullRequest,
  openReviewCard,
  reviewPullRequest,
} from "./pull-requests-api.js";
import { boardSnapshotKeys } from "@/queries/board-snapshot-queries";
import type { ProviderResult } from "@/queries/provider-api";

export const pullRequestsKeys = {
  all: ["pull-requests"] as const,
  repos: ["pull-requests", "repos"] as const,
  detail: (owner: string, repo: string, number: number) =>
    ["pull-requests", owner, repo, number] as const,
};

/** Build the query options that read one pull request detail, refetched on mount once the data is 2 s old. */
export function pullRequestQueryOptions(
  owner: string,
  repo: string,
  number: number,
) {
  return queryOptions({
    queryKey: pullRequestsKeys.detail(owner, repo, number),
    queryFn: () => getPullRequest(owner, repo, number),
    staleTime: 2_000,
  });
}

/** Subscribe a container to one pull request detail. */
export function usePullRequestQuery(
  owner: string,
  repo: string,
  number: number,
) {
  return useQuery(pullRequestQueryOptions(owner, repo, number));
}

interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

type ReviewVars = PullRequestRef & { event: PrReviewEvent; body?: string };

export const reviewMutationOptions = {
  mutationFn: (vars: ReviewVars) =>
    reviewPullRequest(
      vars.owner,
      vars.repo,
      vars.number,
      vars.event,
      vars.body,
    ),
};

export const mergeMutationOptions = {
  mutationFn: (vars: PullRequestRef & { sha: string }) =>
    mergePullRequest(vars.owner, vars.repo, vars.number, vars.sha),
};

/**
 * Run the review mutation and hand the result to `onResult`.
 *
 * @remarks
 * A rejected review resolves a failure result, so the callback sits in `onSuccess` and also runs
 * when the user leaves the page before the request settles.
 */
export function useReviewPullRequestMutation(
  onResult: (result: ProviderResult<object>, vars: ReviewVars) => void,
) {
  return useMutation({ ...reviewMutationOptions, onSuccess: onResult });
}

/**
 * Refetch one pull request detail, including when no observer is mounted.
 *
 * @remarks
 * The merged row can leave the list and unmount the detail before the merge settles, so the
 * default active-only refetch would skip it.
 */
export function refreshPullRequestAfterMerge(
  client: QueryClient,
  ref: PullRequestRef,
): Promise<void> {
  return client.invalidateQueries({
    queryKey: pullRequestsKeys.detail(ref.owner, ref.repo, ref.number),
    refetchType: "all",
  });
}

/**
 * Run the squash merge mutation, hand the result to `onResult`, then refetch the detail.
 *
 * @remarks
 * The refetch runs after a refused merge too, because the head may have moved, and also when the
 * merged row already left the list and unmounted the detail. The mutation stays pending until the
 * refetch ends, so a dialog that closes on settle closes after the page is fresh.
 */
export function useMergePullRequestMutation(
  onResult: (result: ProviderResult<object>) => void,
) {
  const client = useQueryClient();
  return useMutation({
    ...mergeMutationOptions,
    onSuccess: async (result, vars) => {
      onResult(result);
      await refreshPullRequestAfterMerge(client, vars);
    },
  });
}

export function githubReposQueryOptions() {
  return queryOptions({
    queryKey: pullRequestsKeys.repos,
    queryFn: getGithubRepos,
    staleTime: 60_000,
  });
}

export function useGithubReposQuery() {
  return useQuery(githubReposQueryOptions());
}

export const reviewCardMutationOptions = {
  mutationFn: (vars: PullRequestRef & { board: BoardKey }) =>
    openReviewCard(vars.owner, vars.repo, vars.number, vars.board),
};

/**
 * Run the review card mutation, then refetch the board snapshot.
 *
 * @remarks
 * The route emits no stream event for the link between the card and the pull request, so the
 * snapshot is read again. The mutation stays pending until it ends, so the Start dialog finds the card.
 */
export function useOpenReviewCardMutation() {
  const client = useQueryClient();
  return useMutation({
    ...reviewCardMutationOptions,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: boardSnapshotKeys.all }),
  });
}

export function usePullRequestLoader() {
  const client = useQueryClient();
  return (ref: PullRequestRef) =>
    client.fetchQuery(pullRequestQueryOptions(ref.owner, ref.repo, ref.number));
}
