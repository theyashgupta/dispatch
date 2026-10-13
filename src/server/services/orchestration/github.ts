import path from "node:path";
import { prKey, prUrl } from "../../../shared/pr-rows.js";
import type {
  BoardKey,
  PrDetail,
  PrReviewEvent,
  ReviewCardAnswer,
} from "../../../shared/types.js";
import {
  fetchGithubPr,
  mergeGithubPr,
  reviewGithubPr,
} from "../../adapters/source-gateway.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import { getOrchestrationConfig } from "../infra/config-holder.js";
import { listBoards } from "./boards.js";
import { githubRepoAt } from "./github-repos.js";
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

/**
 * The open board and repository path whose `origin` is the GitHub repository `repo`.
 *
 * @remarks
 * The comparison ignores case because GitHub names are case-insensitive. The preferred board wins
 * when it holds the repository; otherwise the first open board in list order does.
 */
async function matchBoardRepo(
  repo: string,
  preferred?: BoardKey,
): Promise<{ boardKey: BoardKey; repoPath: string } | null> {
  const { boards } = await listBoards(() => Promise.resolve(null));
  const ordered = [
    ...boards.filter((board) => board.key === preferred),
    ...boards.filter((board) => board.key !== preferred),
  ];
  for (const board of ordered) {
    if (board.archived) continue;
    for (const { path: repoPath } of board.repositories) {
      const found = await githubRepoAt(repoPath);
      if (found?.toLowerCase() === repo.toLowerCase()) {
        return { boardKey: board.key, repoPath };
      }
    }
  }
  return null;
}

/**
 * Create or reuse the one local card that reviews a pull request.
 *
 * @remarks
 * The card comes from `promoteItem`, so a second call finds the same card. A card that already has
 * a `reviewPr` is left as it is. The item lookup runs before the credential check so an unknown
 * pull request answers 404 whatever the connection state.
 */
export async function openReviewCard(
  owner: string,
  repo: string,
  number: number,
  preferredBoard?: BoardKey,
): Promise<ReviewCardAnswer> {
  const item = store.getItem(prKey(owner, repo, number));
  if (!item || item.source !== "github") throw new NotFoundError("not-found");
  await token();
  const match = await matchBoardRepo(`${owner}/${repo}`, preferredBoard);
  if (!match) throw new ConflictError("no-workspace");

  let head = item.meta.headRef ?? "";
  let base = item.meta.baseRef ?? "";
  if (head === "" || base === "") {
    const detail = await getPullRequest(owner, repo, number);
    head = detail.head;
    base = detail.base;
  }

  const promoted = await store.promoteItem(match.boardKey, item.id);
  if (!promoted) throw new NotFoundError("not-found");
  const { card, created } = promoted;
  if (!card.reviewPr) {
    const url = item.url ?? prUrl(owner, repo, number);
    await store.setCardReview(card.id, {
      reviewPr: {
        repo: `${owner}/${repo}`,
        number,
        url,
        head,
        base,
        repoPath: match.repoPath,
      },
      url,
      workspace: {
        folder: path.dirname(match.repoPath),
        repos: [{ path: match.repoPath, base }],
      },
    });
  }
  return {
    cardId: card.id,
    created,
    column: card.column,
    boardKey: card.boardKey,
  };
}
