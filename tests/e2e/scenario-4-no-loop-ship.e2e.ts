import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Card } from "../../src/shared/types.js";
import { orchestratorScenario } from "./fixtures/scenario-4/orchestrator.js";
import {
  git,
  makeSampleRepo,
  mainSubjects,
  type SampleRepo,
} from "./fixtures/scenario-1/repo.js";
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

const BOARD = "NOL";
const GROUP_ID = "NOL-4";
const RUN_LOG = path.join(EVIDENCE_DIR, "scenario-4-run-log.txt");
const COMMIT_SUBJECT = "feat: no loop group work";
const MERGED_SUBJECT = "feat: no loop group (#1)";
const DONE_MESSAGE = "DISPATCH_STATUS: DONE - built";

const note = makeNote("scenario-4");

/**
 * Post the Stop hook event that a real session sends when its last message holds a status marker.
 *
 * @remarks The sandbox uses the hooks status channel, so the pane marker alone does not move a card. The token is
 * read from the tmux session environment, the same place the hook script of a real session reads it.
 */
async function sendStopHook(
  sb: Sandbox,
  session: string,
  message: string,
): Promise<void> {
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
      last_assistant_message: message,
    }),
  });
  assert.equal(res.status, 204);
}

const worktreeOf = (card: Card, sample: SampleRepo): string =>
  path.join(card.workspacePath ?? "", sample.name);

/** Create the board, policy, two tickets and the main orchestrator, and write the replay files. */
async function setup(
  sb: Sandbox,
): Promise<{ sample: SampleRepo; orchestratorLog: string }> {
  const sample = makeSampleRepo(sb.root, sb.home);
  const sessions = path.join(sb.workspaces, "nol-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "No loop files",
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
  for (const n of [1, 2]) {
    const made = await sb.api<{ id: string }>(
      "POST",
      `/api/cards?board=${BOARD}`,
      { title: `Ticket ${n}`, description: `Do the work of ticket ${n}.` },
    );
    assert.equal(made.status, 201);
    tickets.push(made.body.id);
  }
  assert.deepEqual(tickets, ["NOL-1", "NOL-2"]);
  const added = await sb.api("POST", `/api/boards/${BOARD}/orchestrators`, {
    id: "main",
    name: "Main",
    role: "main",
  });
  assert.equal(added.status, 201);

  const orchestratorLog = path.join(sb.logs, "orchestrator-replay.log");
  fs.writeFileSync(
    path.join(sb.scenarios, "default.json"),
    JSON.stringify(
      orchestratorScenario({
        repo: sample.repo,
        members: tickets,
        title: "No loop group",
        replayLog: orchestratorLog,
        waits: 24,
      }),
    ),
  );
  fs.writeFileSync(
    path.join(sb.scenarios, `${GROUP_ID}.json`),
    JSON.stringify({ statusRows: readyRows(), reply: "ok" }),
  );
  return { sample, orchestratorLog };
}

/** Start the main orchestrator and wait for the group card that it creates and starts. */
async function createAndStart(sb: Sandbox): Promise<Card> {
  const start = await sb.api(
    "POST",
    `/api/boards/${BOARD}/orchestrators/main/start`,
  );
  assert.equal(start.status, 202);
  note("orchestrator started");

  const started = await waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, GROUP_ID);
      return card?.source === "group" && card.tmuxSession !== undefined
        ? card
        : null;
    },
    4 * MINUTE,
    "the group card created and started by the orchestrator",
  );
  assert.equal(started.title, "No loop group");
  note("group started");
  return started;
}

/** Commit the group work, send the done Stop hook, and answer the ship decision item with ship. */
async function finishGroupAndAnswer(
  sb: Sandbox,
  sample: SampleRepo,
  started: Card,
): Promise<void> {
  const worktree = worktreeOf(started, sample);
  assert.equal(
    git(worktree, sb.home, ["rev-parse", "--abbrev-ref", "HEAD"]),
    GROUP_ID,
  );
  fs.writeFileSync(path.join(worktree, "feature.txt"), "group work\n");
  git(worktree, sb.home, ["add", "feature.txt"]);
  git(worktree, sb.home, ["commit", "-q", "-m", COMMIT_SUBJECT]);
  await sendStopHook(sb, started.tmuxSession ?? "", DONE_MESSAGE);

  await waitFor(
    async () => (await cardOf(sb, BOARD, GROUP_ID))?.column === "agent_done",
    4 * MINUTE,
    "the group card in agent_done",
  );
  note("group reached agent_done");

  const gate = await waitFor(
    async () => {
      const open = await sb.api<{ items: { id: string; question: string }[] }>(
        "GET",
        `/api/decisions?board=${BOARD}&state=open`,
      );
      return open.body.items.find((i) => i.question.includes("Ship it"));
    },
    2 * MINUTE,
    "the ship decision item",
  );
  const answer = await sb.api("POST", `/api/decisions/${gate.id}/answer`, {
    optionId: "ship",
  });
  assert.equal(answer.status, 200);
}

/** Assert the replay finished, the PR merged into the bare origin, and the group card is Done. */
async function assertShipped(
  sb: Sandbox,
  sample: SampleRepo,
  started: Card,
  orchestratorLog: string,
): Promise<void> {
  const replay = await waitFor(
    () => {
      const lines = readJsonl(orchestratorLog);
      return lines.at(-1)?.done === true ? lines : null;
    },
    8 * MINUTE,
    "the orchestrator replay to finish its steps",
    { pollMs: 1000 },
  );
  note("replay finished");
  const tools = replay.filter((l) => l.tool !== undefined);
  assert.ok(tools.length >= 10);
  for (const line of tools)
    assert.equal(line.expectMet, true, JSON.stringify(line));
  assert.equal(replay.at(-1)?.stopped, undefined);

  assert.deepEqual(mainSubjects(sample, sb.home), [
    MERGED_SUBJECT,
    "chore: initial commit",
  ]);
  assert.equal(
    git(sample.bare, sb.home, ["show", "main:feature.txt"]),
    "group work",
    "the bare origin main holds the group file",
  );
  const calls = readJsonl(sb.gh.log).map((argv) =>
    Array.isArray(argv) ? argv.map(String) : [],
  );
  const verbs = (verb: string) =>
    calls.filter((c) => c[0] === "pr" && c[1] === verb);
  assert.equal(verbs("create").length, 1);
  assert.equal(verbs("merge").length, 1);

  const done = await waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, GROUP_ID);
      return card?.column === "done" ? card : null;
    },
    MINUTE,
    "the group card in Done",
  );
  assert.equal(done.shipFlow?.state, "done");
  const root = started.workspacePath ?? "";
  assert.equal(
    fs.existsSync(path.join(worktreeOf(started, sample), "ROADMAP.md")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(worktreeOf(started, sample), ".roadmap")),
    false,
  );
  assert.equal(fs.existsSync(path.join(root, ".roadmap")), false);

  const events = await sb.orchestrationEvents(BOARD);
  const created = events.find(
    (e) => e.kind === "tool_call" && e.data.tool === "create_group",
  );
  assert.equal(created?.data.result, `${GROUP_ID} playbook none`);
}

/**
 * Run a board whose group has no loop files, from the group start to the merged ship.
 *
 * @remarks The only inputs after the start are HTTP calls (the answer to a decision item and the Stop hook of the group session) and git
 * commands that the test runs in the group worktree.
 */
async function runScenario(sb: Sandbox): Promise<void> {
  const { sample, orchestratorLog } = await setup(sb);
  const started = await createAndStart(sb);
  await finishGroupAndAnswer(sb, sample, started);
  await assertShipped(sb, sample, started, orchestratorLog);
}

void test(
  "scenario 4: a group with no loop files ships through start_ship to the bare origin",
  { timeout: 20 * MINUTE },
  async () => {
    const sb = await startSandbox({ name: "s4-no-loop-ship" });
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
