import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Card } from "../../src/shared/types.js";
import {
  git,
  makeSampleRepo,
  type SampleRepo,
} from "./fixtures/scenario-1/repo.js";
import { passLine, type LoopSpec } from "./fixtures/scenario-1/loop-files.js";
import { readyRows } from "./fixtures/scenario-1/status-rows.js";
import { cardOf, readJsonl, writeRunLog } from "./harness/board-reads.js";
import {
  EVIDENCE_DIR,
  MINUTE,
  makeNote,
  startSandbox,
  waitFor,
  type Sandbox,
} from "./harness/sandbox.js";

const BOARD = "UBS";
const TICKETS = ["UBS-1", "UBS-2"];
const ORCHESTRATOR_CARD = "UBS-3";
const GROUP_ID = "UBS-4";
const SLUG = "unit-branch";
const BRANCHES = ["feat/UBS-1-unit-1-alpha", "feat/UBS-2-unit-2-beta"];
const TITLES = ["feat: alpha UBS-1", "feat: beta UBS-2"];
const FILES = ["alpha.txt", "beta.txt"];
const RUN_LOG = path.join(EVIDENCE_DIR, "scenario-9-run-log.txt");
const DONE_MESSAGE = "DISPATCH_STATUS: DONE - built";
const SHIP_BODY =
  "What\nThe work of the unit.\nWhy\nThe unit is built.\nHow\nShipped by the test.";
const BUILT = "built, awaiting /ship";

const note = makeNote("scenario-9");

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
}

/**
 * Post the Stop hook event that a real session sends when its last message holds a status marker.
 *
 * @remarks The sandbox uses the hooks status channel, so the pane marker alone does not move a card. The token is
 * read from the tmux session environment, the same place the hook script of a real session reads it.
 */
async function sendStopHook(sb: Sandbox, session: string): Promise<void> {
  const line = sb.tmux([
    "show-environment",
    "-t",
    `=${session}`,
    "DISPATCH_HOOK_TOKEN",
  ]);
  const token = line.trim().replace(/^DISPATCH_HOOK_TOKEN=/, "");
  assert.notEqual(token, "", "the session carries a hook token");
  const res = await fetch(`${sb.url}/api/hook/claude`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dispatch-token": token },
    body: JSON.stringify({
      hook_event_name: "Stop",
      last_assistant_message: DONE_MESSAGE,
    }),
  });
  assert.equal(res.status, 204);
}

const worktreeOf = (card: Card, sample: SampleRepo): string =>
  path.join(card.workspacePath ?? "", sample.name);

async function orch<T = Record<string, unknown>>(
  sb: Sandbox,
  token: string,
  method: string,
  route: string,
  body?: unknown,
): Promise<Reply<T>> {
  const res = await fetch(`${sb.url}/api/orchestrator${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-orchestrator-token": token,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text === "" ? {} : JSON.parse(text)) as T,
  };
}

const awaitSession = (sb: Sandbox, id: string): Promise<Card> =>
  waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, id);
      return card?.tmuxSession !== undefined ? card : null;
    },
    4 * MINUTE,
    `the session of ${id}`,
  );

/** Create the board, the policy, the two tickets and the main orchestrator, and write the replay files. */
async function setup(sb: Sandbox): Promise<SampleRepo> {
  const sample = makeSampleRepo(sb.root, sb.home);
  const sessions = path.join(sb.workspaces, "ubs-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Unit branch ship",
    workspaceRoot: sessions,
    repositories: [
      { path: sample.repo, baseBranch: "main", checkCommand: "true" },
    ],
  });
  assert.equal(board.status, 201);
  const policy = await sb.api("PUT", `/api/boards/${BOARD}/policy`, {
    roadmapApproval: "all",
    concurrencyCap: 2,
    loopModel: "claude-sonnet-5-5:high",
    orchestratorModel: "claude-sonnet-5-5",
    handoffPercent: 50,
    handoffHardPercent: 80,
    usageLimit: "stop",
    shipRights: "merge",
    budgetPerGroup: null,
    supervisor: "on",
    groupPlaybook: null,
  });
  assert.equal(policy.status, 200);
  const tickets: string[] = [];
  for (const [title, description] of [
    ["Add the alpha file", "First unit of the loop."],
    ["Add the beta file", "Second unit of the loop."],
  ]) {
    const made = await sb.api<{ id: string }>(
      "POST",
      `/api/cards?board=${BOARD}`,
      { title, description },
    );
    assert.equal(made.status, 201);
    tickets.push(made.body.id);
  }
  assert.deepEqual(tickets, TICKETS);
  const added = await sb.api("POST", `/api/boards/${BOARD}/orchestrators`, {
    id: "main",
    name: "Main",
    role: "main",
  });
  assert.equal(added.status, 201);
  for (const id of [ORCHESTRATOR_CARD, GROUP_ID]) {
    fs.writeFileSync(
      path.join(sb.scenarios, `${id}.json`),
      JSON.stringify({ statusRows: readyRows(), reply: "ok" }),
    );
  }
  return sample;
}

/**
 * Start the main orchestrator and mint its token.
 *
 * @remarks The start mints the token of the real session and revokes an earlier one, so the token is minted after the session exists.
 */
async function startOrchestrator(sb: Sandbox): Promise<string> {
  const start = await sb.api(
    "POST",
    `/api/boards/${BOARD}/orchestrators/main/start`,
  );
  assert.equal(start.status, 202);
  await waitFor(
    () =>
      sb
        .tmux(["list-sessions", "-F", "#{session_name}"])
        .split("\n")
        .filter((n) => n !== "")
        .find(
          (n) =>
            sb
              .tmux(["show-environment", "-t", `=${n}`, "DISPATCH_CARD_ID"])
              .trim() === `DISPATCH_CARD_ID=${ORCHESTRATOR_CARD}`,
        ),
    MINUTE,
    "the tmux session of the orchestrator card",
  );
  const minted = await sb.api<{ token: string }>(
    "POST",
    `/api/boards/${BOARD}/orchestrators/main/token`,
  );
  assert.equal(minted.status, 201);
  assert.notEqual(minted.body.token, "");
  note("orchestrator started and its token minted");
  return minted.body.token;
}

/** Create the group of the two tickets through the orchestrator routes, start it, and answer its card. */
async function startGroup(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
): Promise<Card> {
  const created = await orch<{ card: Card }>(sb, token, "POST", "/groups", {
    title: "Alpha and beta group",
    memberIds: TICKETS,
    repos: [{ path: sample.repo, base: "main" }],
    direction: "Build both units.",
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.card.id, GROUP_ID);
  const started = await orch(sb, token, "POST", `/groups/${GROUP_ID}/start`);
  assert.equal(started.status, 202);
  const card = await awaitSession(sb, GROUP_ID);
  note(`group ${GROUP_ID} started`);
  return card;
}

/** Create the two stacked unit branches in the group worktree and return to the session branch. */
function stackUnitBranches(sb: Sandbox, sample: SampleRepo, group: Card): void {
  const worktree = worktreeOf(group, sample);
  assert.equal(
    git(worktree, sb.home, ["rev-parse", "--abbrev-ref", "HEAD"]),
    GROUP_ID,
  );
  BRANCHES.forEach((branch, i) => {
    git(worktree, sb.home, ["checkout", "-q", "-b", branch]);
    fs.writeFileSync(path.join(worktree, FILES[i] ?? ""), `${branch}\n`);
    git(worktree, sb.home, ["add", FILES[i] ?? ""]);
    git(worktree, sb.home, ["commit", "-q", "-m", TITLES[i] ?? ""]);
  });
  git(worktree, sb.home, ["checkout", "-q", GROUP_ID]);
  note("two stacked unit branches committed");
}

/**
 * Write the loop files of a two-unit Roadmap loop whose branches appear only in the roadmap Status lines.
 *
 * @remarks The roadmap is written last so the root watch sees it.
 */
function seedLoop(group: Card): void {
  const root = group.workspacePath ?? "";
  const write = (rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const at = new Date().toISOString();
  const roadmap: string[] = [
    `# Alpha and beta roadmap`,
    "",
    `Slug: \`${SLUG}\`.`,
  ];
  [1, 2].forEach((n) => {
    const prd = `sample-app/.planning/prds/${SLUG}-unit-${n}.md`;
    const spec: LoopSpec = {
      slug: SLUG,
      title: `Unit ${n}`,
      ticket: TICKETS[n - 1] ?? "",
      branch: BRANCHES[n - 1] ?? "",
      repoDir: "sample-app",
      phases: ["Build it", "Wire it"],
      clock: () => at,
    };
    write(
      prd,
      [
        `# Unit ${n} PRD`,
        "",
        ...spec.phases.flatMap((name, i) => [
          `### Phase ${i + 1}: ${name}`,
          "- **Retry budget:** 2",
          "",
        ]),
      ].join("\n"),
    );
    write(
      `sample-app/.planning/${SLUG}-unit-${n}/state.md`,
      [1, 2].map((phase) => passLine(spec, phase, at)).join(""),
    );
    roadmap.push(
      "",
      `### Unit ${n}: ${n === 1 ? "Alpha" : "Beta"}`,
      `- **Status:** ${BUILT} (branch \`${BRANCHES[n - 1]}\`, 8073bafe, 676d3279)`,
      `- **PRD:** \`${prd}\``,
    );
  });
  write(
    `.roadmap/${SLUG}/progress.md`,
    [
      `Roadmap: ${root}/ROADMAP.md, slug ${SLUG}`,
      "",
      "## Unit statuses",
      "- Unit 1: committed 8073bafe",
      "- Unit 2: committed 676d3279",
      "",
    ].join("\n"),
  );
  write(
    ".claude/ralph-loop.local.md.done",
    [
      "---",
      "active: false",
      "iteration: 2",
      "session_id: unit-branch-original",
      "max_iterations: 50",
      `completion_promise: "ROADMAP COMPLETE ${SLUG}"`,
      `started_at: "${at}"`,
      "---",
      "",
      `Execute the roadmap at ROADMAP.md, slug ${SLUG}.`,
      "",
    ].join("\n"),
  );
  write("ROADMAP.md", `${roadmap.join("\n")}\n`);
}

/** Bring the group to Agent done and wait until its card shows both unit branches from the roadmap Status lines. */
async function finishGroup(sb: Sandbox, group: Card): Promise<void> {
  await sendStopHook(sb, group.tmuxSession ?? "");
  await waitFor(
    async () => (await cardOf(sb, BOARD, GROUP_ID))?.column === "agent_done",
    4 * MINUTE,
    `${GROUP_ID} in agent_done`,
  );
  note("group reached agent_done");
  await waitFor(
    async () => {
      const progress = (await cardOf(sb, BOARD, GROUP_ID))?.loopProgress;
      return (
        progress?.engine?.closed === true &&
        progress.units.length === 2 &&
        progress.units.every(
          (u, i) => u.status === BUILT && u.branch === BRANCHES[i],
        )
      );
    },
    4 * MINUTE,
    "the card to show both unit branches and the closed engine",
    { pollMs: 1000 },
  );
  note("card shows both unit branches");
}

const shipBody = (sample: SampleRepo, names: string[]) => ({
  repository: sample.repo,
  branches: names.map((name, i) => ({
    name,
    title: TITLES[i] ?? "feat: unit",
    body: SHIP_BODY,
  })),
});

/** Send a branch name with a space and assert the 400 and the absence of a stored flow. */
async function assertBadBranchRefused(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
): Promise<void> {
  const refused = await orch<{ error: string }>(
    sb,
    token,
    "POST",
    `/groups/${GROUP_ID}/ship`,
    shipBody(sample, ["has space"]),
  );
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.equal(refused.body.error, "invalid-branch-name");
  assert.equal((await cardOf(sb, BOARD, GROUP_ID))?.shipFlow, undefined);
  note("branch name with a space refused with invalid-branch-name");
}

const createHeads = (sb: Sandbox): string[] =>
  readJsonl(sb.gh.log)
    .map((argv) => (Array.isArray(argv) ? argv.map(String) : []))
    .filter((c) => c[0] === "pr" && c[1] === "create")
    .map((c) => c[c.indexOf("--head") + 1] ?? "");

/** Ship both feat branches in stack order and wait for the first PR and then for the finished flow. */
async function shipUnitBranches(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
): Promise<void> {
  const shipped = await orch(
    sb,
    token,
    "POST",
    `/groups/${GROUP_ID}/ship`,
    shipBody(sample, BRANCHES),
  );
  assert.equal(shipped.status, 202, JSON.stringify(shipped.body));
  await waitFor(
    () => createHeads(sb).includes(BRANCHES[0] ?? ""),
    5 * MINUTE,
    "the gh pr create of the first unit branch",
    { pollMs: 1000 },
  );
  assert.equal(createHeads(sb)[0], BRANCHES[0]);
  note("the PR step reached with the first feat branch");
  const state = await waitFor(
    async () => {
      const read = await orch<{ flow: { state: string } }>(
        sb,
        token,
        "GET",
        `/groups/${GROUP_ID}/ship`,
      );
      const current = read.body.flow?.state;
      return current === "done" || current === "stopped" ? current : null;
    },
    10 * MINUTE,
    `the ship of ${GROUP_ID} to finish`,
    { pollMs: 1000 },
  );
  assert.equal(state, "done", `the ship of ${GROUP_ID} ended ${state}`);
  assert.deepEqual(createHeads(sb), BRANCHES);
  assert.equal((await cardOf(sb, BOARD, GROUP_ID))?.shipFlow?.state, "done");
  note("both feat branches shipped in stack order");
}

/**
 * Run a finished Roadmap loop group with feat/ unit branches from its start to the finished ship.
 *
 * @remarks The only inputs after the orchestrator start are orchestrator routes called with its token, the Stop hook of the group session, and git
 * and file writes in the session folders.
 */
async function runScenario(sb: Sandbox): Promise<void> {
  const sample = await setup(sb);
  const token = await startOrchestrator(sb);
  const group = await startGroup(sb, sample, token);
  stackUnitBranches(sb, sample, group);
  seedLoop(group);
  await finishGroup(sb, group);
  await assertBadBranchRefused(sb, sample, token);
  await shipUnitBranches(sb, sample, token);
}

void test(
  "scenario 9: a Roadmap loop group whose unit branches use the feat/ prefix ships through start_ship",
  { timeout: 20 * MINUTE },
  async () => {
    const sb = await startSandbox({ name: "s9-unit-branch-ship" });
    try {
      await runScenario(sb);
    } finally {
      try {
        await writeRunLog(sb, BOARD, RUN_LOG);
      } catch (err) {
        note(
          `run log not written: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      await sb.stop();
    }
  },
);
