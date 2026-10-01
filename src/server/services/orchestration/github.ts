import type { PrDetail, PrReviewEvent } from "../../../shared/types.js";
import {
  fetchGithubPr,
  mergeGithubPr,
  reviewGithubPr,
} from "../../adapters/source-gateway.js";
import { getOrchestrationConfig } from "../infra/config-holder.js";
import { resolveGithubToken } from "./github-token.js";

export class GithubNotConnected extends Error {
  constructor() {
    super("no GitHub credential is available");
    this.name = "GithubNotConnected";
  }
}

/**
 * Resolve the token for a pull request call, refusing while the GitHub source is disconnected.
 *
 * @remarks Connect is the user's consent to talk to GitHub, so a Vault token or gh login alone is
 * not enough.
 */
async function token(): Promise<string> {
  if (getOrchestrationConfig()?.sources?.github?.enabled !== true) {
    throw new GithubNotConnected();
  }
  const credential = await resolveGithubToken();
  if (!credential) throw new GithubNotConnected();
  return credential.token;
}

/** Read one pull request's detail with the current GitHub credential. */
export async function getPullRequest(
  owner: string,
  repo: string,
  number: number,
): Promise<PrDetail> {
  return fetchGithubPr(await token(), owner, repo, number);
}

/** Post a review on one pull request with the current GitHub credential. */
export async function reviewPullRequest(
  owner: string,
  repo: string,
  number: number,
  review: { event: PrReviewEvent; body?: string },
): Promise<void> {
  await reviewGithubPr(await token(), owner, repo, number, review);
}

/** Squash merge one pull request at the head commit the user saw. */
export async function mergePullRequest(
  owner: string,
  repo: string,
  number: number,
  sha: string,
): Promise<void> {
  await mergeGithubPr(await token(), owner, repo, number, sha);
}
