import type { ShipBranchState, ShipFlow } from "../../../shared/types.js";

export interface ProseViolation {
  file: string;
  line: string;
  kind: "em-dash" | "double-hyphen" | "unparsed-header";
}

const EM_DASH = String.fromCharCode(0x2014);
const DOUBLE_HYPHEN = "-".repeat(2);
const SCOPED_DIRS = ["docs/", "src/", "scripts/", ".claude/"];
const TABLE_DELIMITER_RE = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
const CODE_SPAN_RE = /`[^`]*`/g;
const COMMENT_STARTS = ["*", "/**", "//", "#"];
const FAILED_STATES = new Set(["FAILURE", "ERROR"]);
const PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const EMPTY_GRACE_POLLS = 3;
const CLAUSE_SPLIT_RE = /(?<=[.!?])\s+|[,;]/;
const SIGNATURE_RULE_RE = /\bmust have verified signatures?\b/i;
const RULESET_HEADER_RE = /^repository rule violations found\.?$/i;
const OPERATION_RE = /^\(\w+\)$/;
const REPO_PART_RE = /^[A-Za-z0-9_.-]+$/;

/** Whether a repository path falls under the prose rule. */
function inScope(file: string): boolean {
  return file === "CLAUDE.md" || SCOPED_DIRS.some((d) => file.startsWith(d));
}

/** Whether an added line of `file` is prose, where a double hyphen is refused. */
function isProseLine(file: string, line: string, inFence: boolean): boolean {
  if (file.endsWith(".md")) {
    return !inFence && !TABLE_DELIMITER_RE.test(line.trim());
  }
  const start = line.trimStart();
  return COMMENT_STARTS.some((s) => start.startsWith(s));
}

/**
 * The em dashes and prose double hyphens on the added lines of a unified diff.
 *
 * @remarks Fence state is tracked over the context and added lines a hunk shows, so a fence opened
 * outside every hunk is not seen. A hunk under a header that names no `b/` path and no deletion is
 * an `unparsed-header` violation, so a diff the parser cannot read fails closed.
 */
export function proseViolations(diff: string): ProseViolation[] {
  const found: ProseViolation[] = [];
  let file: string | null = null;
  let deleted = false;
  let inHunk = false;
  let inFence = false;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff ")) {
      file = null;
      deleted = false;
      inHunk = false;
      inFence = false;
      continue;
    }
    if (!inHunk && raw.startsWith("+++ ")) {
      const target = raw.slice(4).replace(/\t$/, "");
      file = target.startsWith("b/") ? target.slice(2) : null;
      deleted = target === "/dev/null";
      continue;
    }
    if (raw.startsWith("@@")) {
      if (!inHunk && file === null && !deleted) {
        found.push({ file: "", line: raw, kind: "unparsed-header" });
      }
      inHunk = true;
      continue;
    }
    if (!inHunk || file === null || !inScope(file)) continue;
    if (!raw.startsWith("+") && !raw.startsWith(" ")) continue;
    const line = raw.slice(1);
    const fence = /^\s*(```|~~~)/.test(line);
    if (raw.startsWith("+")) {
      if (line.includes(EM_DASH)) found.push({ file, line, kind: "em-dash" });
      if (
        !fence &&
        isProseLine(file, line, inFence) &&
        line.replace(CODE_SPAN_RE, "").includes(DOUBLE_HYPHEN)
      ) {
        found.push({ file, line, kind: "double-hyphen" });
      }
    }
    if (fence && file.endsWith(".md")) inFence = !inFence;
  }
  return found;
}

/** Check the tip commit of main against the identity read at ship start. */
export function identityCheck(
  expected: { name: string; email: string },
  tip: { authorName: string; authorEmail: string; message: string },
): { ok: true } | { ok: false; reason: string } {
  if (tip.authorName !== expected.name || tip.authorEmail !== expected.email) {
    return {
      ok: false,
      reason: `author ${tip.authorName} <${tip.authorEmail}> is not ${expected.name} <${expected.email}>`,
    };
  }
  if (/^co-authored-by:/im.test(tip.message)) {
    return { ok: false, reason: "commit has a Co-Authored-By line" };
  }
  return { ok: true };
}

/** The outcome of one rollup entry: a check run by its conclusion, a status context by its state. */
function checkOutcome(c: {
  conclusion?: string | null;
  state?: string | null;
  status?: string | null;
}): "pending" | "passed" | "failed" {
  const conclusion = (c.conclusion ?? "").toUpperCase();
  if (conclusion !== "" || c.status?.toUpperCase() === "COMPLETED") {
    return PASSED.has(conclusion) ? "passed" : "failed";
  }
  const state = (c.state ?? "").toUpperCase();
  if (PASSED.has(state)) return "passed";
  return FAILED_STATES.has(state) ? "failed" : "pending";
}

/**
 * Fold a `statusCheckRollup` into one check state at the `poll`th poll, counting from 1.
 *
 * @remarks GitHub lists the checks of a new PR a little after it opens, so an empty rollup is
 * pending for the first 3 polls and passed after that. A completed check with any conclusion
 * outside SUCCESS, NEUTRAL and SKIPPED is failed, so an unknown conclusion never waits forever.
 */
export function checksState(
  rollup: {
    conclusion?: string | null;
    state?: string | null;
    status?: string | null;
  }[],
  poll: number,
): "pending" | "passed" | "failed" {
  if (rollup.length === 0) {
    return poll <= EMPTY_GRACE_POLLS ? "pending" : "passed";
  }
  const outcomes = rollup.map(checkOutcome);
  if (outcomes.includes("failed")) return "failed";
  return outcomes.every((o) => o === "passed") ? "passed" : "pending";
}

/**
 * Whether a failed `gh pr merge` was refused by the verified signature rule and no other rule.
 *
 * @remarks The admin retry bypasses every rule that the stderr names, so each violation clause (a
 * line split on sentence ends, commas and semicolons, without the `GraphQL:` prefix, a list bullet,
 * the ruleset header and the operation name) must match the signature rule's own wording.
 */
export function isSignatureBlock(stderr: string): boolean {
  const violations = stderr
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^graphql:\s*/i, "")
        .replace(/^[-*]\s+/, ""),
    )
    .flatMap((line) => line.split(CLAUSE_SPLIT_RE))
    .map((part) => part.trim())
    .filter(
      (part) =>
        part !== "" &&
        !RULESET_HEADER_RE.test(part) &&
        !OPERATION_RE.test(part),
    );
  return (
    violations.length > 0 &&
    violations.every((part) => SIGNATURE_RULE_RE.test(part))
  );
}

/**
 * The `OWNER/NAME` that gh's repo option takes for a github.com remote URL, or null for any other.
 *
 * @remarks An SSH host alias or another host has no gh login under that name, so it gets null and
 * gh resolves the remote itself. `ssh.github.com` is GitHub's SSH over port 443 endpoint.
 */
export function repoOfRemote(url: string): string | null {
  const trimmed = url.trim();
  const match =
    /^(?!file:)[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i.exec(
      trimmed,
    ) ?? /^(?:[^@/:]+@)?([^/:]+):(?!\/\/)(.+)$/.exec(trimmed);
  if (!match) return null;
  const host = (match[1] ?? "").replace(/:\d+$/, "").toLowerCase();
  if (host !== "github.com" && host !== "ssh.github.com") return null;
  const parts = (match[2] ?? "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "")
    .split("/");
  if (parts.length !== 2 || !parts.every((p) => REPO_PART_RE.test(p))) {
    return null;
  }
  return parts.join("/");
}

/** The ship state a branch moves to after `state` completes under `rights`. */
export function nextBranchState(
  state: ShipBranchState,
  rights: ShipFlow["rights"],
): ShipBranchState {
  switch (state) {
    case "queued":
      return "merging_main";
    case "merging_main":
      return "checking";
    case "checking":
      return "pushing";
    case "pushing":
      return "waiting_checks";
    case "waiting_checks":
      return rights === "merge" ? "merging" : "waiting_merge";
    case "merging":
    case "waiting_merge":
      return "verifying";
    case "verifying":
    case "merged":
      return "merged";
    case "failed":
      return "failed";
  }
}
