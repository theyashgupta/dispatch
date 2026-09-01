import { existsSync } from "node:fs";
import { run } from "./exec.js";
import type { PrInfo, ProbeFailureCategory } from "../../shared/types.js";

interface GhCheckRun {
  status?: string;
  conclusion?: string;
  state?: string;
}

const PASSING_CONCLUSIONS = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);

/** The only `StatusState` values a legacy commit status may be read as green on. */
const LEGACY_PASSING_STATES = new Set(["SUCCESS"]);

/** The only `StatusState` values a legacy commit status may be read as still-running on. */
const LEGACY_PENDING_STATES = new Set(["PENDING", "EXPECTED"]);

interface GhPrResult {
  number: number;
  url: string;
  title: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  statusCheckRollup: GhCheckRun[] | null;
}

const loggedCategories = new Set<string>();

/**
 * The outcome of a `gh pr list` lookup for one repo: either the mapped PR list, or the failure
 * category the caller must surface as "could not check" (F-03/F-04).
 */
export type PrProbeResult =
  { ok: true; prs: PrInfo[] } | { ok: false; category: ProbeFailureCategory };

/**
 * Narrow `gh`'s own `state` token to the closed {@link PrInfo} union, reading anything
 * unrecognised as `open`.
 *
 * @remarks
 * A bare cast asserted rather than validated, so an unknown token flowed all the way to
 * `pr-style.ts`, which falls through its two `if`s to the GREEN open branch: a false green on an
 * affordance whose whole job is to be trusted at a glance, plus a `NaN` sort comparison from a
 * rank lookup that returned undefined.
 */
function stateOf(raw: string): PrInfo["state"] {
  const s = raw.toLowerCase();
  return s === "merged" || s === "closed" ? s : "open";
}

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
 *
 * BOTH branches are allowlists, not just the CheckRun one. The legacy branch used to test `state`
 * against the two failure tokens and the two pending tokens and let everything else fall through to
 * `pass` — the exact shape this doc block forbids, and the shape of a bug this codebase has already
 * shipped once. Today's `StatusState` enum happens to be fully covered, so the fallthrough was
 * latent rather than live, but a widened enum member, a lower-cased `gh` output, or a non-enum state
 * from a legacy provider would each have painted a green dot on a check that did not pass.
 *
 * The caller passes `pr.statusCheckRollup ?? []`, and the field is typed nullable so that coalesce
 * cannot be dropped silently: `gh` reports `null` for a PR whose head commit is gone, which
 * `--state all` now reaches, and a throw here lands INSIDE `listPrsForBranch`'s own `try`, which
 * reclassifies a SUCCESSFUL lookup as `gh pr list failed`, blanks the whole repo's list and spends
 * a `PROBE_FAILURE_CEILING` strike every tick until last-known-good is wiped.
 */
function rollupOf(checks: GhCheckRun[]): "pass" | "fail" | "pending" | null {
  if (checks.length === 0) return null;
  const legacy = (c: GhCheckRun) => c.state != null;
  if (
    checks.some((c) =>
      legacy(c)
        ? !LEGACY_PASSING_STATES.has(c.state ?? "") &&
          !LEGACY_PENDING_STATES.has(c.state ?? "")
        : c.status === "COMPLETED" &&
          !PASSING_CONCLUSIONS.has(c.conclusion ?? ""),
    )
  ) {
    return "fail";
  }
  if (
    checks.some((c) =>
      legacy(c)
        ? LEGACY_PENDING_STATES.has(c.state ?? "")
        : c.status !== "COMPLETED",
    )
  ) {
    return "pending";
  }
  return "pass";
}

/**
 * The PR(s) `gh pr list` reports for `branch` in `repoPath`, as a `PrProbeResult`.
 *
 * @remarks
 * `--state all` is required, not incidental: `gh pr list` defaults to open PRs only, so the tick
 * after a merge returns nothing and the badge vanishes — the exact opposite of the contract that a
 * merged or closed PR keeps its badge. `--limit` bounds the historical PRs a long-lived reused
 * branch can accumulate under that flag.
 *
 * The three-state result matters: `{ ok: true, prs: [] }` means the lookup succeeded and this
 * branch genuinely has no PR, which must clear the card; `{ ok: false, category }` means the
 * lookup failed and the caller must leave the last known value alone AND surface `category` as
 * unknown, so a transient timeout cannot wipe a badge and silently pass as "no PR". Never rethrows
 * — a missing or unauthenticated `gh` must read as an absence, never a thrown card-visible error.
 * Each failure category logs once (T-04-04): the classification happens here rather than at the
 * call site because the category is only derivable from the error object, and passing raw `gh`
 * stderr upward would leak it into a log this contract promises stays content-free. The latch is
 * per category rather than a single global bool so the first transient failure cannot permanently
 * mask a later, different one. The category now ALSO rides the return value (F-03/F-04) — it does
 * not stop being logged.
 *
 * The GraphQL `"Could not resolve to a Repository"` substring — captured live on `gh` 2.96.0 against
 * a real repo owned by the machine's inactive `gh` account (F-04) — gets its OWN category rather
 * than folding into `"gh not authenticated"`. GitHub returns that identical message for "does not
 * exist" and "you cannot see it" by design (verified live against a remote pointing at a repository
 * that genuinely does not exist), so the substring cannot distinguish an auth problem from a
 * renamed, deleted, or mistyped remote. Sending a user to `gh auth login` to fix a remote URL is
 * worse than naming both possibilities, so `"gh not authenticated"` is now reserved for the
 * unambiguous signals — `HTTP 401` and `gh auth login`.
 *
 * A spawn failure is discriminated on `.code` being a STRING (`exec.ts`'s documented contract: a
 * number is a real exit status) rather than on the message containing `ENOENT`. That alone is still
 * not enough to blame the CLI, because `run()` passes `cwd: repoPath` and a NONEXISTENT cwd raises
 * the same `ENOENT` a missing `gh` binary does — verified live, identical `.code` and identical
 * message for both. `existsSync(repoPath)` therefore splits them, so a registered repo folder the
 * user moved or deleted mid-session reports the folder rather than latching
 * "gh CLI not available" forever while `gh` is installed and healthy. The `existsSync` cost is paid
 * only on the failure path, never on a successful lookup.
 *
 * `repo` is supplied by the caller, not derived here, because repo identity is only knowable at
 * the call site (`artifact-detect.ts` already holds `workspace.repos[i]`'s own path); a folder
 * basename is passed rather than `repoPath` so no absolute path can reach the wire (T-98-01).
 *
 * A `429`/`403` throttle response is classified as its own `"gh rate limited"` category, checked
 * before the `HTTP 401` test in the same ternary chain: `gh` never emits `HTTP 401` or
 * `gh auth login` for a rate-limit response, so the ordering is not load-bearing for correctness,
 * grouping the two rate-limit phrasings together simply keeps the chain readable.
 */
export async function listPrsForBranch(
  repoPath: string,
  branch: string,
  repo: string,
): Promise<PrProbeResult> {
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
    return {
      ok: true,
      prs: raw.map((pr) => ({
        number: pr.number,
        url: pr.url,
        title: pr.title,
        state: stateOf(pr.state),
        isDraft: pr.isDraft,
        ci: rollupOf(pr.statusCheckRollup ?? []),
        repo,
      })),
    };
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    const stderr = (err as { stderr?: string }).stderr ?? "";
    const category: ProbeFailureCategory =
      typeof code === "string"
        ? existsSync(repoPath)
          ? "gh unavailable"
          : "repo path missing"
        : stderr.includes("API rate limit exceeded") ||
            stderr.includes("secondary rate limit")
          ? "gh rate limited"
          : stderr.includes("HTTP 401") || stderr.includes("gh auth login")
            ? "gh not authenticated"
            : stderr.includes("Could not resolve to a Repository")
              ? "gh repo not accessible"
              : "gh pr list failed";
    if (!loggedCategories.has(category)) {
      loggedCategories.add(category);
      console.error(`[artifact-detect] ${category}`);
    }
    return { ok: false, category };
  }
}
