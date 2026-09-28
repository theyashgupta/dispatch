import type {
  PrCheck,
  PrCheckState,
  PrDetail,
  PrFile,
  PrReviewEvent,
} from "../../../shared/types.js";
import { githubRequest } from "./github.source.js";

export const PATCH_MAX = 6000;

export const FILES_MAX = 50;

const PASSING_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

export interface RawPull {
  title: string;
  body?: string | null;
  html_url: string;
  user?: { login?: string } | null;
  state: string;
  merged_at?: string | null;
  draft?: boolean;
  base: { ref: string };
  head: { ref: string; sha: string };
  additions?: number;
  deletions?: number;
  changed_files?: number;
}

export interface RawFile {
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
}

export interface RawCheckRun {
  name: string;
  status?: string;
  conclusion?: string | null;
  html_url?: string | null;
  details_url?: string | null;
}

export interface RawStatus {
  context: string;
  state: string;
  target_url?: string | null;
}

/**
 * Read one check run as pass, pending or fail.
 *
 * @remarks Pass is an allowlist, as in gh.ts: a completed run whose conclusion is not success,
 * skipped or neutral is a failure, so cancelled, timed out, action required and any unknown value
 * never paint a green check.
 */
export function classifyCheckRun(run: RawCheckRun): PrCheckState {
  if (run.status !== undefined && run.status !== "completed") return "pending";
  return PASSING_CONCLUSIONS.has(run.conclusion ?? "") ? "pass" : "fail";
}

/** Read one legacy commit status as pass, pending or fail; anything but success or pending fails. */
export function classifyStatus(state: string): PrCheckState {
  if (state === "success") return "pass";
  if (state === "pending") return "pending";
  return "fail";
}

const RANK: Record<PrCheckState, number> = { fail: 0, pending: 1, pass: 2 };

const webUrl = (url: string | null | undefined) =>
  url && /^https?:\/\//i.test(url) ? url : undefined;

/** Merge check runs and legacy statuses into one list, failing checks first, then by name. */
export function mergeChecks(
  runs: readonly RawCheckRun[],
  statuses: readonly RawStatus[],
): PrCheck[] {
  const checks: PrCheck[] = [
    ...runs.map((r) => {
      const url = webUrl(r.html_url ?? r.details_url);
      return {
        name: r.name,
        state: classifyCheckRun(r),
        ...(url ? { url } : {}),
      };
    }),
    ...statuses.map((s) => {
      const url = webUrl(s.target_url);
      return {
        name: s.context,
        state: classifyStatus(s.state),
        ...(url ? { url } : {}),
      };
    }),
  ];
  return checks.sort(
    (a, b) => RANK[a.state] - RANK[b.state] || a.name.localeCompare(b.name),
  );
}

/**
 * Shape a pull request, its files and its checks into the detail the page renders.
 *
 * @remarks Files stop at 50 and each patch at 6000 characters, each cut flagged, so one huge PR
 * cannot blow up the response. A merged PR reads as merged even though GitHub reports it closed.
 */
export function mapPrDetail(
  pull: RawPull,
  files: readonly RawFile[],
  checks: PrCheck[],
  checksTruncated = false,
): PrDetail {
  const mapped: PrFile[] = files.slice(0, FILES_MAX).map((f) => {
    const patch = f.patch;
    return {
      filename: f.filename,
      status: f.status ?? "modified",
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
      ...(patch !== undefined ? { patch: patch.slice(0, PATCH_MAX) } : {}),
      patchTruncated: patch !== undefined && patch.length > PATCH_MAX,
    };
  });
  return {
    title: pull.title,
    url: pull.html_url,
    author: pull.user?.login ?? "",
    state: pull.merged_at
      ? "merged"
      : pull.state === "closed"
        ? "closed"
        : "open",
    draft: pull.draft === true,
    body: pull.body ?? "",
    base: pull.base.ref,
    head: pull.head.ref,
    headSha: pull.head.sha,
    additions: pull.additions ?? 0,
    deletions: pull.deletions ?? 0,
    changedFiles: pull.changed_files ?? files.length,
    files: mapped,
    filesTruncated:
      files.length > FILES_MAX || (pull.changed_files ?? 0) > FILES_MAX,
    checks,
    checksTruncated,
  };
}

const CHECKS_MAX = 100;

const repoPath = (owner: string, repo: string) =>
  `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

/** Read a pull request with its first 50 files and every check on its head commit. */
export async function fetchPrDetail(
  token: string,
  owner: string,
  repo: string,
  number: number,
): Promise<PrDetail> {
  const base = repoPath(owner, repo);
  const pull = (await (
    await githubRequest(token, `${base}/pulls/${number}`)
  ).json()) as RawPull;
  const files = (await (
    await githubRequest(
      token,
      `${base}/pulls/${number}/files?per_page=${FILES_MAX}`,
    )
  ).json()) as RawFile[];
  const sha = encodeURIComponent(pull.head.sha);
  const runs = (await (
    await githubRequest(
      token,
      `${base}/commits/${sha}/check-runs?per_page=${CHECKS_MAX}`,
    )
  ).json()) as { total_count?: number; check_runs?: RawCheckRun[] };
  const status = (await (
    await githubRequest(
      token,
      `${base}/commits/${sha}/status?per_page=${CHECKS_MAX}`,
    )
  ).json()) as { total_count?: number; statuses?: RawStatus[] };
  const runList = runs.check_runs ?? [];
  const statusList = status.statuses ?? [];
  return mapPrDetail(
    pull,
    files,
    mergeChecks(runList, statusList),
    (runs.total_count ?? 0) > runList.length ||
      (status.total_count ?? 0) > statusList.length,
  );
}

/** Post a review on a pull request. */
export async function postPrReview(
  token: string,
  owner: string,
  repo: string,
  number: number,
  review: { event: PrReviewEvent; body?: string },
): Promise<void> {
  await githubRequest(
    token,
    `${repoPath(owner, repo)}/pulls/${number}/reviews`,
    {
      method: "POST",
      body: review.body ? review : { event: review.event },
    },
  );
}

/**
 * Squash merge a pull request, only when its head is still the commit the user reviewed.
 *
 * @remarks GitHub refuses the merge with 409 when the head moved, so a push that lands after the
 * user opened the detail can never be merged unseen.
 */
export async function squashMergePr(
  token: string,
  owner: string,
  repo: string,
  number: number,
  sha: string,
): Promise<void> {
  await githubRequest(token, `${repoPath(owner, repo)}/pulls/${number}/merge`, {
    method: "PUT",
    body: { merge_method: "squash", sha },
  });
}
