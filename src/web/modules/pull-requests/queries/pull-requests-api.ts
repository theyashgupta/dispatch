import type { PrDetail, PrReviewEvent } from "../../../../shared/types.js";
import {
  providerFailure,
  providerFetch,
  type ProviderResult,
} from "@/queries/provider-api";

function prPath(owner: string, repo: string, number: number): string {
  return `/api/github/pr/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${number}`;
}

/** Read one pull request's detail: GET /api/github/pr/:owner/:repo/:number. */
export async function getPullRequest(
  owner: string,
  repo: string,
  number: number,
): Promise<ProviderResult<{ detail: PrDetail }>> {
  const result = await providerFetch<PrDetail>(prPath(owner, repo, number));
  if (!result?.ok) return providerFailure(result);
  return { ok: true, detail: result.data };
}

/** Post a review on a pull request: POST /api/github/pr/:owner/:repo/:number/review. */
export async function reviewPullRequest(
  owner: string,
  repo: string,
  number: number,
  event: PrReviewEvent,
  body?: string,
): Promise<ProviderResult<object>> {
  const result = await providerFetch(`${prPath(owner, repo, number)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ? { event, body } : { event }),
  });
  return result?.ok ? { ok: true } : providerFailure(result);
}

/** Squash merge a pull request at the head the user saw: POST .../merge. */
export async function mergePullRequest(
  owner: string,
  repo: string,
  number: number,
  sha: string,
): Promise<ProviderResult<object>> {
  const result = await providerFetch(`${prPath(owner, repo, number)}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha }),
  });
  return result?.ok ? { ok: true } : providerFailure(result);
}
