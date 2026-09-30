import type { PrDetail, PrReviewEvent } from "../../../../shared/types.js";
import { http, type ApiResult } from "@/lib/http";

export type PrRequestResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string; message?: string; ssoUrl?: string };

type PrResponse<T> = ApiResult<T> | null;

/** Request a pull request route, turning a network failure into a null result. */
async function prFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<PrResponse<T>> {
  try {
    return await http<T>(url, init);
  } catch {
    return null;
  }
}

function prFailure(result: PrResponse<unknown>): {
  ok: false;
  error: string;
  message?: string;
  ssoUrl?: string;
} {
  if (!result || result.ok) return { ok: false, error: "unreachable" };
  const body = (result.body ?? {}) as {
    message?: unknown;
    ssoUrl?: unknown;
  };
  return {
    ok: false,
    error: result.error ?? "unreachable",
    ...(typeof body.message === "string" ? { message: body.message } : {}),
    ...(typeof body.ssoUrl === "string" ? { ssoUrl: body.ssoUrl } : {}),
  };
}

function prPath(owner: string, repo: string, number: number): string {
  return `/api/github/pr/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${number}`;
}

/** Read one pull request's detail: GET /api/github/pr/:owner/:repo/:number. */
export async function getPullRequest(
  owner: string,
  repo: string,
  number: number,
): Promise<PrRequestResult<{ detail: PrDetail }>> {
  const result = await prFetch<PrDetail>(prPath(owner, repo, number));
  if (!result?.ok) return prFailure(result);
  return { ok: true, detail: result.data };
}

/** Post a review on a pull request: POST /api/github/pr/:owner/:repo/:number/review. */
export async function reviewPullRequest(
  owner: string,
  repo: string,
  number: number,
  event: PrReviewEvent,
  body?: string,
): Promise<PrRequestResult<object>> {
  const result = await prFetch(`${prPath(owner, repo, number)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ? { event, body } : { event }),
  });
  return result?.ok ? { ok: true } : prFailure(result);
}

/** Squash merge a pull request at the head the user saw: POST .../merge. */
export async function mergePullRequest(
  owner: string,
  repo: string,
  number: number,
  sha: string,
): Promise<PrRequestResult<object>> {
  const result = await prFetch(`${prPath(owner, repo, number)}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha }),
  });
  return result?.ok ? { ok: true } : prFailure(result);
}
