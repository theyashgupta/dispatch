import { run } from "./exec.js";
import type { PrInfo } from "../../shared/types.js";

interface GhCheckRun {
  status?: string;
  conclusion?: string;
  state?: string;
}

const PASSING_CONCLUSIONS = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);

interface GhPrResult {
  number: number;
  url: string;
  title: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  statusCheckRollup: GhCheckRun[];
}

const loggedCategories = new Set<string>();

/**
 * Reduce a `statusCheckRollup` into the badge's single CI verdict, in fixed precedence: no checks
 * at all yields null so the dot is omitted rather than drawn neutral, then any failure, then any
 * still-in-flight check, else pass.
 *
 * @remarks
 * The rollup mixes two node shapes and neither field set appears on both, so each node is routed by
 * which one it has. An Actions check is a `CheckRun` carrying `status`/`conclusion`; a legacy commit
 * status (Vercel, Netlify, classic CircleCI) is a `StatusContext` carrying only `state`. Two
 * failure modes follow from reading only one shape: testing `status` alone pins every legacy check
 * to "pending" forever, because its `status` is undefined and so never equals `COMPLETED`; and
 * treating any completed run that is not literally `FAILURE` as a pass paints a green dot on
 * `CANCELLED`, `TIMED_OUT` and `ACTION_REQUIRED`. Pass is therefore an allowlist, not a fallthrough
 * — an unrecognised conclusion reads as a failure, since a false green is the worst outcome for an
 * affordance whose whole job is to be trusted at a glance.
 */
function rollupOf(checks: GhCheckRun[]): "pass" | "fail" | "pending" | null {
  if (checks.length === 0) return null;
  const legacy = (c: GhCheckRun) => c.state != null;
  if (
    checks.some((c) =>
      legacy(c)
        ? c.state === "FAILURE" || c.state === "ERROR"
        : c.status === "COMPLETED" &&
          !PASSING_CONCLUSIONS.has(c.conclusion ?? ""),
    )
  ) {
    return "fail";
  }
  if (
    checks.some((c) =>
      legacy(c)
        ? c.state === "PENDING" || c.state === "EXPECTED"
        : c.status !== "COMPLETED",
    )
  ) {
    return "pending";
  }
  return "pass";
}

/**
 * The PR(s) `gh pr list` reports for `branch` in `repoPath`, or `null` when the lookup itself
 * failed.
 *
 * @remarks
 * `--state all` is required, not incidental: `gh pr list` defaults to open PRs only, so the tick
 * after a merge returns nothing and the badge vanishes — the exact opposite of the contract that a
 * merged or closed PR keeps its badge. `--limit` bounds the historical PRs a long-lived reused
 * branch can accumulate under that flag.
 *
 * The `null`-vs-`[]` split matters: `[]` means the lookup succeeded and this branch genuinely has
 * no PR, which must clear the card; `null` means the lookup failed and the caller must leave the
 * last known value alone, so a transient timeout cannot wipe a badge and re-broadcast it. Never
 * rethrows — a missing or unauthenticated `gh` must read as an absence, never a card-visible error.
 * Each failure category logs once (T-04-04): the classification happens here rather than at the
 * call site because the category is only derivable from the error object, and passing raw `gh`
 * stderr upward would leak it into a log this contract promises stays content-free. The latch is
 * per category rather than a single global bool so the first transient failure cannot permanently
 * mask a later, different one — this feature's only diagnostic.
 */
export async function listPrsForBranch(
  repoPath: string,
  branch: string,
): Promise<PrInfo[] | null> {
  try {
    const { stdout } = await run(
      "gh",
      [
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "all",
        "--limit",
        "20",
        "--json",
        "number,url,state,isDraft,statusCheckRollup,title",
      ],
      { cwd: repoPath, timeout: 8000 },
    );
    const raw = JSON.parse(stdout) as GhPrResult[];
    return raw.map((pr) => ({
      number: pr.number,
      url: pr.url,
      title: pr.title,
      state: pr.state.toLowerCase() as PrInfo["state"],
      isDraft: pr.isDraft,
      ci: rollupOf(pr.statusCheckRollup),
    }));
  } catch (err) {
    const message = (err as Error).message ?? "";
    const stderr = (err as { stderr?: string }).stderr ?? "";
    const category = message.includes("ENOENT")
      ? "gh unavailable"
      : stderr.includes("HTTP 401") || stderr.includes("gh auth login")
        ? "gh not authenticated"
        : "gh pr list failed";
    if (!loggedCategories.has(category)) {
      loggedCategories.add(category);
      console.error(`[pr-detect] ${category}`);
    }
    return null;
  }
}
