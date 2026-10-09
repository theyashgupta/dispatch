import fs from "node:fs";
import path from "node:path";
import { ENGINE_FILE } from "../domain/loop-progress.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { hasLoopProgress } from "../../../shared/running-group.js";
import type {
  BoardKey,
  Card,
  ShipBranch,
  ShipBranchState,
  ShipFlow,
} from "../../../shared/types.js";
import { run } from "../../adapters/exec.js";
import { boardRepository as store } from "../../store/board-repository.js";
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "../domain/errors.js";
import { checkShipRights } from "../domain/orchestrator-policy.js";
import { mayShip } from "../domain/orchestrator-rules.js";
import type { OrchestratorIdentity } from "../domain/orchestrator-scope.js";
import {
  checksState,
  identityCheck,
  isSignatureBlock,
  nextBranchState,
  proseViolations,
  repoOfRemote,
} from "../domain/ship-checks.js";
import { worktreePath } from "../domain/workspace-paths.js";
import {
  callerPolicy,
  dependencyDone,
  getBoard,
  resolveBoard,
} from "./boards.js";
import { moveCard } from "./card-move.js";
import { createDecisionItem } from "./decision-items.js";
import { recordGroupState } from "./group-state-events.js";
import { enforce } from "./orchestrator-groups.js";

export const shipTools: { run: typeof run; pollMs: number } = {
  run,
  pollMs: 30_000,
};

const DISPATCH_PACKAGE = "@theyashgupta/dispatch";
const CHECK_TIMEOUT_MS = 30 * 60_000;
const CALL_TIMEOUT_MS = 120_000;
const NETWORK_TIMEOUT_MS = 300_000;
const MAX_BUFFER = 64 * 1024 * 1024;
const MAX_POLL_FAILURES = 5;
const PLAIN_BASE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const FINISHED_STATUSES = new Set(["built, awaiting /ship", "shipped"]);
const RESERVED_BRANCHES = new Set(["main", "master", "HEAD"]);
const END_OF_OPTIONS = "-".repeat(2);
const AFTER_MERGE_MAIN: ReadonlySet<ShipBranchState> = new Set([
  "checking",
  "pushing",
  "waiting_checks",
  "merging",
  "waiting_merge",
  "verifying",
]);
const DIFF = [
  "-c",
  "color.ui=never",
  "-c",
  "color.diff=never",
  "-c",
  "diff.noprefix=false",
  "-c",
  "diff.srcPrefix=a/",
  "-c",
  "diff.dstPrefix=b/",
  "-c",
  "core.quotePath=false",
  "diff",
  "--no-ext-diff",
];

interface ShipInput {
  repository: string;
  branches: { name: string; title: string; body: string }[];
}

interface Runner {
  cardId: string;
  boardKey: BoardKey;
  flow: ShipFlow;
  worktree: string;
  checkCommand: string | null;
  resumed: boolean;
}

class ShipStop extends Error {}

class CardGone extends Error {}

const startingBoards = new Set<string>();

/** The first non-empty line of a failed command's stderr, else of its message. */
function firstLine(err: unknown): string {
  const e = err as { stderr?: string; message?: string };
  const text = e.stderr?.trim() ? e.stderr : (e.message ?? String(err));
  return (
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l !== "") ?? "command failed"
  );
}

/** The exec options of one git or gh call in `cwd`, with a time limit and a 64 MiB buffer. */
function callOptions(cwd: string, timeout = CALL_TIMEOUT_MS) {
  return { cwd, timeout, maxBuffer: MAX_BUFFER, killEscalationMs: 5_000 };
}

/** Run one git or gh call in the worktree and return its trimmed stdout. */
async function exec(
  r: Pick<Runner, "worktree">,
  cmd: string,
  args: string[],
  timeout?: number,
): Promise<string> {
  return (
    await shipTools.run(cmd, args, callOptions(r.worktree, timeout))
  ).stdout.trim();
}

/**
 * The worktree and check command of a card's ship repository.
 *
 * @remarks The check command is null when the board has no entry for the repository, so a caller
 * can refuse it; an entry with an empty command skips the check. The board view is read so the
 * default board finds the workspace folders as its repositories.
 */
function shipTarget(
  card: Card,
  repository: string,
): { worktree: string; checkCommand: string | null } {
  const board = getBoard(card.boardKey ?? DEFAULT_BOARD_KEY);
  return {
    worktree: worktreePath(card.workspacePath ?? "", repository),
    checkCommand:
      board.repositories.find((r) => r.path === repository)?.checkCommand ??
      null,
  };
}

/**
 * Throw the typed 400 unless each name is allowed for the group.
 *
 * @remarks A group with loop progress allows a unit branch or the specs branch of the loop. A group
 * with no loop progress allows only its session branch, else its identifier. `main`, `master`,
 * `HEAD`, a full ref name and the repository base are refused for both, so no flow pushes to a
 * protected branch.
 */
function assertGroupBranches(
  card: Card,
  repository: string,
  names: string[],
): void {
  let allowed: Set<string>;
  if (hasLoopProgress(card)) {
    const { units, slug } = card.loopProgress;
    allowed = new Set(units.flatMap((u) => (u.branch ? [u.branch] : [])));
    if (slug) allowed.add(`test/${slug}-specs`);
  } else {
    allowed = new Set([card.branch || card.identifier]);
  }
  const base = card.workspace?.repos.find((r) => r.path === repository)?.base;
  for (const name of names) {
    if (
      !allowed.has(name) ||
      RESERVED_BRANCHES.has(name) ||
      name.startsWith("refs/") ||
      name === base
    ) {
      throw new ValidationError("invalid-branch-name", { branch: name });
    }
  }
}

/** Throw the typed 409 when a flow on the board runs or is being started. */
function assertNoRunningFlow(boardKey: BoardKey): void {
  const running = store
    .listCards(boardKey)
    .some((c) => c.shipFlow?.state === "running");
  if (running || startingBoards.has(boardKey)) {
    throw new ConflictError("ship-flow-running");
  }
}

/**
 * Check the ship preconditions of a group card in their fixed order, with no git call and no write.
 *
 * @remarks A group whose engine is active and not closed is refused whatever its unit count. A
 * group with loop progress also needs finished units, and one with no loop progress needs the
 * Agent done column. A refusal is a typed error, so a refused call stores no flow.
 */
function assertShippable(
  caller: OrchestratorIdentity,
  card: Card,
  { repository, branches }: ShipInput,
): ShipFlow["rights"] {
  if (card.source !== "group") throw new ValidationError("not-group-card");
  if (
    !mayShip(resolveBoard(caller.boardKey).orchestrators, caller.orchestratorId)
  ) {
    throw new ForbiddenError("main-only");
  }
  const policy = callerPolicy(caller);
  enforce(checkShipRights(policy));
  if (!card.workspace?.repos.some((r) => r.path === repository)) {
    throw new ValidationError("unknown-repository");
  }
  const engine = card.loopProgress?.engine;
  if (engine?.active && !engine.closed) {
    throw new ConflictError("engine-not-closed");
  }
  if (hasLoopProgress(card)) {
    if (card.loopProgress.units.some((u) => !FINISHED_STATUSES.has(u.status))) {
      throw new ConflictError("loop-not-finished");
    }
  } else if (card.column !== "agent_done") {
    throw new ConflictError("card-not-done");
  }
  assertGroupBranches(
    card,
    repository,
    branches.map((b) => b.name),
  );
  const waiting = (card.dependsOn ?? []).filter((id) => !dependencyDone(id));
  if (waiting.length > 0) {
    throw new ConflictError("dependency-not-merged", {
      reason: waiting.join(", "),
    });
  }
  assertNoRunningFlow(caller.boardKey);
  return policy.shipRights === "merge" ? "merge" : "open_prs";
}

/**
 * Throw the typed 409 unless each branch is ahead of its base and the worktree is clean.
 *
 * @remarks Only a group with no loop progress runs it, because that group has no loop that
 * vouches for its branches. The base is `origin/<base>` when that ref exists, because the session
 * branch is cut from it, else the local base. It runs before any write, so a refusal stores no flow.
 */
async function assertAheadAndClean(
  card: Card,
  input: ShipInput,
  target: { worktree: string },
): Promise<void> {
  const base = card.workspace?.repos.find(
    (r) => r.path === input.repository,
  )?.base;
  const branch = input.branches[0]?.name;
  if (base === undefined || !PLAIN_BASE_RE.test(base) || base.includes("..")) {
    throw new ConflictError("unknown-base", { branch });
  }
  let baseRef: string | null = null;
  for (const ref of [`refs/remotes/origin/${base}`, `refs/heads/${base}`]) {
    const found = await exec(target, "git", [
      "rev-parse",
      "--verify",
      "--quiet",
      ref,
    ]).catch(() => null);
    if (found !== null) {
      baseRef = ref;
      break;
    }
  }
  if (baseRef === null) throw new ConflictError("unknown-base", { branch });
  for (const { name } of input.branches) {
    const count = await exec(target, "git", [
      "rev-list",
      "--count",
      `${END_OF_OPTIONS}end-of-options`,
      `${baseRef}..refs/heads/${name}`,
    ]).catch(() => null);
    const ahead = count === null ? NaN : Number.parseInt(count, 10);
    if (!Number.isFinite(ahead)) throw new ConflictError("no-workspace");
    if (ahead === 0) {
      throw new ConflictError("branch-not-ahead", { branch: name });
    }
  }
  const status = await exec(target, "git", ["status", "--porcelain"]).catch(
    () => null,
  );
  if (status === null) throw new ConflictError("no-workspace");
  if (status !== "") throw new ConflictError("worktree-dirty");
}

/**
 * Check the preconditions, store a running flow and start its runner in the background.
 *
 * @remarks The board is held in an in-memory set from the check to the store write, so two starts
 * on one board cannot both pass the running flow check.
 */
export async function startShip(
  caller: OrchestratorIdentity,
  card: Card,
  input: ShipInput,
): Promise<ShipFlow> {
  const rights = assertShippable(caller, card, input);
  if (!card.workspacePath) throw new ConflictError("no-workspace");
  const noLoop = !hasLoopProgress(card);
  if (noLoop && fs.existsSync(path.join(card.workspacePath, ENGINE_FILE))) {
    throw new ConflictError("engine-not-closed");
  }
  const target = shipTarget(card, input.repository);
  if (target.checkCommand === null) {
    throw new ValidationError("unknown-repository");
  }
  if (!fs.existsSync(target.worktree)) throw new ConflictError("no-workspace");
  startingBoards.add(caller.boardKey);
  try {
    for (const { name } of input.branches) {
      const local = await exec(target, "git", [
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${name}`,
      ]).catch(() => null);
      if (local === null) {
        throw new ValidationError("invalid-branch-name", { branch: name });
      }
    }
    if (noLoop) await assertAheadAndClean(card, input, target);
    const gitConfig = (key: string) => exec(target, "git", ["config", key]);
    let identity: ShipFlow["identity"];
    try {
      identity = {
        name: await gitConfig("user.name"),
        email: await gitConfig("user.email"),
      };
    } catch {
      throw new ConflictError("no-git-identity");
    }
    if (identity.name === "" || identity.email === "") {
      throw new ConflictError("no-git-identity");
    }
    const origin = await exec(target, "git", [
      "remote",
      "get-url",
      "origin",
    ]).catch(() => "");
    const flow: ShipFlow = {
      state: "running",
      rights,
      repository: input.repository,
      repo: repoOfRemote(origin),
      orchestratorId: caller.orchestratorId,
      identity,
      branches: input.branches.map((b) => ({
        ...b,
        state: "queued",
        pr: null,
        checks: null,
        identity: null,
        admin: false,
        tip: null,
        checked: null,
      })),
      failedStep: null,
      reason: null,
      decisionId: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    await store.setShipFlow(card.id, flow);
    launch({
      cardId: card.id,
      boardKey: caller.boardKey,
      flow: structuredClone(flow),
      ...target,
      resumed: false,
    });
    return flow;
  } finally {
    startingBoards.delete(caller.boardKey);
  }
}

/**
 * Start a runner without awaiting it; a runner that throws is stored as stopped.
 *
 * @remarks A throw can come from the stop handler itself, so the flow is written as stopped with
 * the error line here, and a second failure is only logged. A runner whose card is gone stops with
 * no write.
 */
function launch(r: Runner): void {
  void runFlow(r).catch(async (err: unknown) => {
    if (err instanceof CardGone) {
      console.warn(`[ship] flow of ${r.cardId} ended: the card is gone`);
      return;
    }
    const reason = firstLine(err);
    console.error(`[ship] flow of ${r.cardId} failed: ${reason}`);
    Object.assign(r.flow, {
      state: "stopped",
      reason,
      finishedAt: new Date().toISOString(),
    });
    await persist(r).catch((again: unknown) => {
      console.error(
        `[ship] flow of ${r.cardId} not stored: ${firstLine(again)}`,
      );
    });
    recordGroupState(store.getCard(r.cardId), "ship_stopped", reason);
  });
}

/** Store the flow on its card; a card that is gone throws so the runner stops with no write. */
async function persist(r: Runner): Promise<void> {
  if (store.getCard(r.cardId) === undefined) throw new CardGone();
  await store.setShipFlow(r.cardId, r.flow);
}

function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, shipTools.pollMs));
}

/**
 * Stop the flow when the board ship rights became `none`; with `open_prs` the flow no longer merges.
 *
 * @remarks The runner calls it before each step and each poll, so the user can stop a running flow
 * by changing the board policy. The policy is read from the board the runner stored, and a card
 * that is gone stops the runner.
 */
function applyShipRights(r: Runner): void {
  if (store.getCard(r.cardId) === undefined) throw new CardGone();
  const rights = store.getBoard(r.boardKey)?.policy.shipRights ?? "none";
  if (rights === "none") throw new ShipStop("ship rights were removed");
  if (rights !== "merge") r.flow.rights = "open_prs";
}

/**
 * Check out the branch, record its tip, merge origin/main and record the merged commit.
 *
 * @remarks A conflict aborts the merge. The recorded commit is the one the check runs on and the
 * one that is pushed and merged.
 */
async function mergeMain(r: Runner, branch: ShipBranch): Promise<void> {
  if ((await exec(r, "git", ["status", "--porcelain"])) !== "") {
    throw new ShipStop("worktree has uncommitted changes");
  }
  await exec(r, "git", ["fetch", "origin"], NETWORK_TIMEOUT_MS);
  await exec(r, "git", ["checkout", "--no-guess", branch.name, END_OF_OPTIONS]);
  if (branch.tip === null) {
    branch.tip = await exec(r, "git", ["rev-parse", "HEAD"]);
    await persist(r);
  }
  try {
    await exec(r, "git", ["merge", "--no-edit", "origin/main"]);
  } catch (err) {
    await exec(r, "git", ["merge", "--abort"]).catch(() => undefined);
    throw new ShipStop(firstLine(err));
  }
  branch.checked = await exec(r, "git", ["rev-parse", "HEAD"]);
  await persist(r);
}

/** Stop the flow unless HEAD is still the commit the check ran on. */
async function assertCheckedHead(r: Runner, branch: ShipBranch): Promise<void> {
  const head = await exec(r, "git", ["rev-parse", "HEAD"]);
  if (branch.checked === null || head !== branch.checked) {
    throw new ShipStop("branch moved since the check");
  }
}

/** gh arguments with the repo option of the origin remote, when the origin names one. */
function ghArgs(r: Runner, args: string[]): string[] {
  return r.flow.repo === null ? args : [...args, "--repo", r.flow.repo];
}

async function changedFiles(
  r: Runner,
  from: string,
  to: string,
): Promise<string[]> {
  const out = await exec(r, "git", [...DIFF, "--name-only", from, to]);
  return out === "" ? [] : out.split("\n");
}

/** Whether the worktree is the Dispatch repository, where the prose rule applies. */
function isDispatchRepo(worktree: string): boolean {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(worktree, "package.json"), "utf8"),
    ) as { name?: unknown };
    return pkg.name === DISPATCH_PACKAGE;
  } catch {
    return false;
  }
}

/**
 * Check that the diff holds only this branch, the prose rule and the repository check command.
 *
 * @remarks The branch's own files run from the previous branch's stored tip to this branch's tip
 * before the merge. Only the first branch, which has no previous tip, uses its merge base.
 */
async function check(r: Runner, branch: ShipBranch): Promise<void> {
  const tip = branch.tip ?? (await exec(r, "git", ["rev-parse", "HEAD"]));
  const prev = r.flow.branches[r.flow.branches.indexOf(branch) - 1];
  const base =
    prev?.tip ?? (await exec(r, "git", ["merge-base", "origin/main", tip]));
  const own = new Set(await changedFiles(r, base, tip));
  const extra = (await changedFiles(r, "origin/main", "HEAD")).filter(
    (f) => !own.has(f),
  );
  if (extra.length > 0) {
    throw new ShipStop(`files outside this branch: ${extra.join(", ")}`);
  }
  if (isDispatchRepo(r.worktree)) {
    const found = proseViolations(
      await exec(r, "git", [...DIFF, "origin/main", "HEAD"]),
    );
    if (found.some((v) => v.kind === "unparsed-header")) {
      throw new ShipStop("unparsed diff header");
    }
    const first = found[0];
    if (first) {
      throw new ShipStop(
        `prose rule: ${found.length} violations, first ${first.kind} in ${first.file}`,
      );
    }
  }
  if (r.checkCommand === null) {
    throw new ShipStop("the repository has no board entry");
  }
  const argv = r.checkCommand.split(/\s+/).filter((a) => a !== "");
  if (argv.length === 0) return;
  try {
    await shipTools.run(
      "env",
      ["-u", "NODE_ENV", ...argv],
      callOptions(r.worktree, CHECK_TIMEOUT_MS),
    );
  } catch (err) {
    throw new ShipStop(`check command failed: ${firstLine(err)}`);
  }
}

/**
 * The number of the open PR the branch can reuse, or null when there is none.
 *
 * @remarks Only a same-repository PR into main whose head is the checked commit counts, so an older
 * PR into another base or a fork PR with the same head name is never adopted.
 */
async function openPrOf(r: Runner, branch: ShipBranch): Promise<number | null> {
  const out = await exec(
    r,
    "gh",
    ghArgs(r, [
      "pr",
      "list",
      "--head",
      branch.name,
      "--base",
      "main",
      "--state",
      "open",
      "--json",
      "number,baseRefName,isCrossRepository,headRefOid",
    ]),
  );
  const match = (JSON.parse(out) as Record<string, unknown>[]).find(
    (pr) =>
      pr.baseRefName === "main" &&
      pr.isCrossRepository === false &&
      pr.headRefOid === branch.checked &&
      Number.isSafeInteger(pr.number) &&
      (pr.number as number) > 0,
  );
  return match === undefined ? null : (match.number as number);
}

/**
 * Push the branch and open its PR unless a PR is recorded or open for the branch.
 *
 * @remarks A new `start_ship` after a stop has no recorded PR, so it reuses the open PR of the
 * branch, since `gh pr create` refuses a second PR for one head.
 */
async function pushAndOpen(r: Runner, branch: ShipBranch): Promise<void> {
  if (branch.checked === null)
    throw new ShipStop("branch moved since the check");
  await exec(
    r,
    "git",
    ["push", "-u", "origin", `${branch.checked}:refs/heads/${branch.name}`],
    NETWORK_TIMEOUT_MS,
  );
  if (branch.pr !== null) return;
  const open = await openPrOf(r, branch);
  if (open !== null) {
    branch.pr = open;
    await persist(r);
    return;
  }
  const url = await exec(
    r,
    "gh",
    ghArgs(r, [
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      branch.name,
      "--title",
      branch.title,
      "--body",
      branch.body,
    ]),
  );
  const pr = Number(url.split("\n").at(-1)?.split("/").at(-1));
  if (!Number.isSafeInteger(pr) || pr <= 0) {
    throw new ShipStop(`no PR number in gh output: ${url.slice(0, 200)}`);
  }
  branch.pr = pr;
  await persist(r);
}

async function viewPr(
  r: Runner,
  pr: number,
  fields: string,
): Promise<Record<string, unknown>> {
  const out = await exec(
    r,
    "gh",
    ghArgs(r, ["pr", "view", String(pr), "--json", fields]),
  );
  return JSON.parse(out) as Record<string, unknown>;
}

/**
 * Poll one PR until `done` answers true, checking the ship rights before each poll.
 *
 * @remarks A failed `gh pr view` is retried at the next poll; five failures in a row stop the flow.
 */
async function pollPr(
  r: Runner,
  branch: ShipBranch,
  fields: string,
  done: (view: Record<string, unknown>) => Promise<boolean>,
): Promise<void> {
  let failures = 0;
  for (;;) {
    applyShipRights(r);
    let view: Record<string, unknown> | null = null;
    try {
      view = await viewPr(r, branch.pr!, fields);
      failures = 0;
    } catch (err) {
      failures += 1;
      if (failures >= MAX_POLL_FAILURES) {
        throw new ShipStop(
          `PR poll failed ${failures} times: ${firstLine(err)}`,
        );
      }
    }
    if (view !== null && (await done(view))) return;
    await pause();
  }
}

/** Poll the PR checks until they pass; a failure stops the flow. */
async function waitChecks(r: Runner, branch: ShipBranch): Promise<void> {
  let polls = 0;
  await pollPr(r, branch, "state,statusCheckRollup", async (view) => {
    polls += 1;
    const rollup = Array.isArray(view.statusCheckRollup)
      ? (view.statusCheckRollup as Parameters<typeof checksState>[0])
      : [];
    const state = checksState(rollup, polls);
    if (branch.checks !== state) {
      branch.checks = state;
      await persist(r);
    }
    if (state === "failed") throw new ShipStop("PR checks failed");
    return state === "passed";
  });
}

/**
 * Squash merge the PR, once more as admin when the signature rule blocks it.
 *
 * @remarks The merge names the checked commit as the head it must match, so a push to the PR
 * branch after the check is never merged.
 */
async function mergePr(r: Runner, branch: ShipBranch): Promise<void> {
  if (branch.checked === null)
    throw new ShipStop("branch moved since the check");
  const args = [
    "pr",
    "merge",
    String(branch.pr),
    "--squash",
    "--subject",
    `${branch.title} (#${branch.pr})`,
    "--body",
    "",
    "--match-head-commit",
    branch.checked,
  ];
  try {
    await exec(r, "gh", ghArgs(r, args));
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (!isSignatureBlock(stderr)) throw new ShipStop(firstLine(err));
    try {
      await exec(r, "gh", ghArgs(r, [...args, "--admin"]));
    } catch (again) {
      throw new ShipStop(firstLine(again));
    }
    branch.admin = true;
    await persist(r);
  }
}

/** Poll the PR until the user merges it; a closed PR stops the flow. */
async function waitMerge(r: Runner, branch: ShipBranch): Promise<void> {
  await pollPr(r, branch, "state", ({ state }) => {
    if (state === "CLOSED") throw new ShipStop("PR was closed without a merge");
    return Promise.resolve(state === "MERGED");
  });
}

/** Check the author and message of the new main tip against the start identity. */
async function verify(r: Runner, branch: ShipBranch): Promise<void> {
  await exec(r, "git", ["fetch", "origin"], NETWORK_TIMEOUT_MS);
  const out = await exec(r, "git", [
    "log",
    "-1",
    "--format=%an%x00%ae%x00%B",
    "origin/main",
  ]);
  const [authorName = "", authorEmail = "", message = ""] = out.split("\0");
  const result = identityCheck(r.flow.identity, {
    authorName,
    authorEmail,
    message,
  });
  branch.identity = result.ok ? "passed" : "failed";
  if (!result.ok) throw new ShipStop(result.reason);
}

async function step(
  r: Runner,
  branch: ShipBranch,
  state: ShipBranchState,
): Promise<void> {
  switch (state) {
    case "merging_main":
      return mergeMain(r, branch);
    case "checking":
      return check(r, branch);
    case "pushing":
      return pushAndOpen(r, branch);
    case "waiting_checks":
      return waitChecks(r, branch);
    case "merging":
      return mergePr(r, branch);
    case "waiting_merge":
      return waitMerge(r, branch);
    case "verifying":
      return verify(r, branch);
    case "queued":
    case "merged":
    case "failed":
      return;
    default:
      return state satisfies never;
  }
}

/** Mark the flow stopped at `state` on `branch` and raise one `ship_failure` decision item. */
async function stop(
  r: Runner,
  branch: ShipBranch,
  state: ShipBranchState,
  reason: string,
): Promise<void> {
  if (store.getCard(r.cardId) === undefined) throw new CardGone();
  branch.state = "failed";
  Object.assign(r.flow, {
    state: "stopped",
    failedStep: state,
    reason,
    finishedAt: new Date().toISOString(),
  });
  const item = createDecisionItem(
    {
      boardKey: r.boardKey,
      orchestratorId: r.flow.orchestratorId,
    },
    {
      cardId: r.cardId,
      kind: "ship_failure",
      question: `Ship stopped at ${state} on ${branch.name}: ${reason}`,
      options: [
        { id: "retry", label: "Fix it, then start the ship again" },
        { id: "stop", label: "Stop shipping this group" },
      ],
      recommendedOptionId: "retry",
    },
  );
  r.flow.decisionId = item.id;
  await persist(r);
  recordGroupState(store.getCard(r.cardId), "ship_stopped", reason);
}

/**
 * Ship each branch in order from the first one not merged, persisting every state change.
 *
 * @remarks A branch re-enters the state it was in, which is safe to repeat: a fetch, a merge of an
 * up to date branch, a push of the checked commit, or a view of a recorded PR. A resumed branch at
 * `checking` or later first checks that HEAD is still the checked commit. A flow whose rights fell
 * to `open_prs` waits for the user merge in place of `merging`.
 */
async function runFlow(r: Runner): Promise<void> {
  for (const branch of r.flow.branches) {
    if (branch.state === "merged") continue;
    let state =
      branch.state === "queued"
        ? nextBranchState("queued", r.flow.rights)
        : branch.state;
    let resumedAfterMerge = r.resumed && AFTER_MERGE_MAIN.has(state);
    while (state !== "merged") {
      try {
        applyShipRights(r);
        if (state === "merging" && r.flow.rights !== "merge") {
          state = "waiting_merge";
        }
        branch.state = state;
        await persist(r);
        if (resumedAfterMerge) {
          resumedAfterMerge = false;
          await assertCheckedHead(r, branch);
        }
        await step(r, branch, state);
      } catch (err) {
        if (err instanceof CardGone) throw err;
        const reason = err instanceof ShipStop ? err.message : firstLine(err);
        await stop(r, branch, state, reason);
        return;
      }
      state = nextBranchState(state, r.flow.rights);
    }
    branch.state = "merged";
  }
  let move = false;
  try {
    applyShipRights(r);
    move = r.flow.rights === "merge";
  } catch (err) {
    if (!(err instanceof ShipStop)) throw err;
  }
  r.flow.state = "done";
  r.flow.finishedAt = new Date().toISOString();
  await persist(r);
  recordGroupState(store.getCard(r.cardId), "shipped", "every branch merged");
  if (move) await moveToDone(r);
}

/**
 * Move a shipped group to Done; a refused move keeps the flow done and asks the user to move it.
 *
 * @remarks Every branch is merged at this point, so a failed move must not turn the flow into a
 * stopped one that a new `start_ship` would ship again.
 */
async function moveToDone(r: Runner): Promise<void> {
  try {
    await moveCard(r.cardId, "done");
  } catch (err) {
    const item = createDecisionItem(
      { boardKey: r.boardKey, orchestratorId: r.flow.orchestratorId },
      {
        cardId: r.cardId,
        kind: "ship_failure",
        question: `Every branch merged, but the move to Done failed: ${firstLine(err)}. Move the group to Done by hand.`,
        options: [
          { id: "moved", label: "I moved the group to Done" },
          { id: "leave", label: "Leave the group where it is" },
        ],
        recommendedOptionId: "moved",
      },
    );
    r.flow.decisionId = item.id;
    await persist(r);
  }
}

/**
 * Restart the runner of every stored flow that was running when the server stopped.
 *
 * @remarks A card with no workspace path, as after a Done cleanup, has no worktree to run git in,
 * so its flow stops at once with a decision item.
 */
export function resumeShipFlows(): void {
  for (const board of store.listBoards()) {
    for (const card of store.listCards(board.key)) {
      const flow = card.shipFlow;
      if (flow?.state !== "running") continue;
      const r: Runner = {
        cardId: card.id,
        boardKey: card.boardKey ?? DEFAULT_BOARD_KEY,
        flow: structuredClone(flow),
        ...shipTarget(card, flow.repository),
        resumed: true,
      };
      if (card.workspacePath) {
        launch(r);
        continue;
      }
      const branch = r.flow.branches.find((b) => b.state !== "merged");
      void (
        branch === undefined
          ? Promise.resolve()
          : stop(r, branch, branch.state, "group has no workspace")
      ).catch((err: unknown) =>
        console.error(
          `[ship] flow of ${card.id} not stopped: ${firstLine(err)}`,
        ),
      );
    }
  }
}
