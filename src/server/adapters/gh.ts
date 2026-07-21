import { run } from "./exec.js";
import type { PrInfo } from "../../shared/types.js";

interface GhCheckRun {
  status?: "QUEUED" | "IN_PROGRESS" | "COMPLETED";
  conclusion?: "SUCCESS" | "FAILURE" | "SKIPPED" | "NEUTRAL" | "";
  state?: "EXPECTED" | "ERROR" | "FAILURE" | "PENDING" | "SUCCESS";
}

interface GhPrResult {
  number: number;
  url: string;
  title: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  statusCheckRollup: GhCheckRun[];
}

let loggedFailure = false;

/**
 * Reduce a `statusCheckRollup` into the badge's single CI verdict, in fixed precedence: no checks
 * at all yields null so the dot is omitted rather than drawn neutral, then any failure, then any
 * still-in-flight check, else pass — SUCCESS/SKIPPED/NEUTRAL all read as pass.
 *
 * @remarks
 * `statusCheckRollup` mixes two node shapes and neither field set is present on both. A modern
 * Actions check is a `CheckRun` carrying `status`/`conclusion`; a legacy commit status (Vercel,
 * Netlify, classic CircleCI) is a `StatusContext` carrying only `state`. Reading `status` alone
 * pins every legacy check to "pending" forever, since its `status` is `undefined` and so never
 * equals `COMPLETED`.
 */
function rollupOf(checks: GhCheckRun[]): "pass" | "fail" | "pending" | null {
  if (checks.length === 0) return null;
  if (
    checks.some(
      (c) =>
        c.conclusion === "FAILURE" ||
        c.state === "FAILURE" ||
        c.state === "ERROR",
    )
  ) {
    return "fail";
  }
  if (
    checks.some((c) =>
      c.state != null
        ? c.state === "PENDING" || c.state === "EXPECTED"
        : c.status !== "COMPLETED",
    )
  ) {
    return "pending";
  }
  return "pass";
}

/**
 * The PR(s) open for `branch` in `repoPath`, via `gh pr list`. Swallows EVERY failure category
 * (missing binary, unauthenticated, no remote, timeout, malformed JSON) into `[]` — a missing or
 * unauthenticated `gh` must read as an absence, never a card-visible error, so this must never
 * rethrow to the poller. On first failure only, logs one content-free category line (T-04-04): the
 * classification happens here rather than at the poller call site because the category can only
 * be derived from the error object itself, and passing raw `gh` stderr up to the caller would leak
 * it into a log that this function's own contract promises stays content-free.
 */
export async function listPrsForBranch(
  repoPath: string,
  branch: string,
): Promise<PrInfo[]> {
  try {
    const { stdout } = await run(
      "gh",
      [
        "pr",
        "list",
        "--head",
        branch,
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
    if (!loggedFailure) {
      loggedFailure = true;
      const message = (err as Error).message ?? "";
      const stderr = (err as { stderr?: string }).stderr ?? "";
      const category = message.includes("ENOENT")
        ? "gh unavailable"
        : stderr.includes("HTTP 401") || stderr.includes("gh auth login")
          ? "gh not authenticated"
          : "gh pr list failed";
      console.error(`[pr-detect] ${category}`);
    }
    return [];
  }
}
