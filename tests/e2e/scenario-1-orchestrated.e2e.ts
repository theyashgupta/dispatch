import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Card } from "../../src/shared/types.js";
import {
  alphaLoop,
  betaLoop,
  groupScenario,
  transcriptDirOf,
} from "./fixtures/scenario-1/group-loops.js";
import {
  limitMenuFields,
  CREDITS_ROW,
  STOP_ROW,
} from "./fixtures/scenario-1/limit-menu.js";
import type { LoopSpec } from "./fixtures/scenario-1/loop-files.js";
import { orchestratorScenario } from "./fixtures/scenario-1/orchestrator.js";
import {
  addUnitBranch,
  makeSampleRepo,
  mainSubjects,
} from "./fixtures/scenario-1/repo.js";
import {
  assertSafePort,
  EVIDENCE_DIR,
  MINUTE,
  makeNote,
  PORT_FIRST,
  PORT_LAST,
  sleep,
  startSandbox,
  waitFor,
  type OrchestrationEventRow,
  type Sandbox,
} from "./harness/sandbox.js";
import { cardOf, readJsonl, writeRunLog } from "./harness/board-reads.js";

const BOARD = "ORC";
const RUN_LOG = path.join(EVIDENCE_DIR, "scenario-1-run-log.txt");
const ALPHA_ID = "ORC-6";
const BETA_ID = "ORC-7";
const ALPHA_BRANCH = "feat/ORC-1-alpha-unit";
const BETA_BRANCH = "feat/ORC-3-beta-unit";

interface Snapshot {
  cards: Card[];
}

const note = makeNote("scenario-1");

async function snapshot(sb: Sandbox): Promise<Snapshot> {
  const res = await sb.api<Snapshot>("GET", `/api/board?board=${BOARD}`);
  assert.equal(res.status, 200);
  return res.body;
}

function actionsOf(
  events: OrchestrationEventRow[],
  action: string,
  cardId?: string,
): OrchestrationEventRow[] {
  return events.filter(
    (e) =>
      e.kind === "supervisor_action" &&
      e.data.action === action &&
      (cardId === undefined || e.cardId === cardId),
  );
}

function loopSpec(
  slug: string,
  title: string,
  ticket: string,
  branch: string,
  repoDir: string,
  t0: number,
): LoopSpec {
  return {
    slug,
    title,
    ticket,
    branch,
    repoDir,
    phases: ["Scaffold", "Wire", "Verify"],
    clock: (n) =>
      new Date(t0 + n * MINUTE).toISOString().replace(/\.\d+Z$/, "Z"),
  };
}

/**
 * Run the whole orchestrated board: handoff, usage stop, failed gate, machine sleep and ship, with no key sent by the test.
 *
 * @remarks The only inputs after the start are HTTP calls a user makes (the resume button, the answer to a
 * decision item) and scenario file writes that the fake session picks up.
 */
async function runScenario(
  sb: Sandbox,
  watcher: AbortController,
): Promise<void> {
  const sample = makeSampleRepo(sb.root, sb.home);
  const t0 = Date.now() - 30 * MINUTE;
  const alpha = loopSpec(
    "s1-alpha",
    "Alpha",
    "ORC-1",
    ALPHA_BRANCH,
    sample.name,
    t0,
  );
  const beta = loopSpec(
    "s1-beta",
    "Beta",
    "ORC-3",
    BETA_BRANCH,
    sample.name,
    t0,
  );
  addUnitBranch(sample, sb.home, ALPHA_BRANCH, "alpha.txt");
  addUnitBranch(sample, sb.home, BETA_BRANCH, "beta.txt");

  const ordered = path.join(sb.workspaces, "orc-sessions");
  fs.mkdirSync(ordered, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Orchestrated",
    workspaceRoot: ordered,
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
  });
  assert.equal(policy.status, 200);
  const tickets: string[] = [];
  for (const n of [1, 2, 3, 4]) {
    const made = await sb.api<{ id: string }>(
      "POST",
      `/api/cards?board=${BOARD}`,
      { title: `Ticket ${n}`, description: `Do the work of ticket ${n}.` },
    );
    assert.equal(made.status, 201);
    tickets.push(made.body.id);
  }
  assert.deepEqual(tickets, ["ORC-1", "ORC-2", "ORC-3", "ORC-4"]);
  const added = await sb.api("POST", `/api/boards/${BOARD}/orchestrators`, {
    id: "main",
    name: "Main",
    role: "main",
  });
  assert.equal(added.status, 201);

  const alphaWs = path.join(ordered, ALPHA_ID);
  const betaWs = path.join(ordered, BETA_ID);
  for (const ws of [alphaWs, betaWs]) {
    fs.mkdirSync(transcriptDirOf(sb.home, ws), { recursive: true });
  }
  const alphaPaths = {
    workspace: alphaWs,
    home: sb.home,
    replayLog: path.join(sb.logs, "alpha-replay.log"),
    keyLog: path.join(sb.logs, "alpha-keys.log"),
  };
  const betaPaths = {
    workspace: betaWs,
    home: sb.home,
    replayLog: path.join(sb.logs, "beta-replay.log"),
    keyLog: path.join(sb.logs, "beta-keys.log"),
  };
  const orchestratorLog = path.join(sb.logs, "orchestrator-replay.log");
  const betaFile = path.join(sb.scenarios, `${BETA_ID}.json`);
  const betaBody = (extra: Record<string, unknown> = {}) =>
    groupScenario(betaPaths, betaLoop(beta), extra);
  const writeScenario = (name: string, body: Record<string, unknown>) =>
    fs.writeFileSync(path.join(sb.scenarios, name), JSON.stringify(body));
  writeScenario(
    "default.json",
    orchestratorScenario({
      repo: sample.repo,
      alpha: {
        title: "Alpha group",
        members: ["ORC-1", "ORC-2"],
        branch: ALPHA_BRANCH,
      },
      beta: {
        title: "Beta group",
        members: ["ORC-3", "ORC-4"],
        branch: BETA_BRANCH,
      },
      replayLog: orchestratorLog,
      gateWaits: 24,
    }),
  );
  writeScenario(
    `${ALPHA_ID}.json`,
    groupScenario(alphaPaths, alphaLoop(alpha)),
  );
  writeScenario(`${BETA_ID}.json`, betaBody());

  const failedGateSeen = watchFailedGate(sb, watcher.signal);
  failedGateSeen.catch(() => undefined);

  const start = await sb.api(
    "POST",
    `/api/boards/${BOARD}/orchestrators/main/start`,
  );
  assert.equal(start.status, 202);
  note("orchestrator started");

  const groups = await waitFor(
    async () => {
      const cards = (await snapshot(sb)).cards.filter(
        (c) => c.source === "group",
      );
      return cards.length === 2 ? cards : null;
    },
    4 * MINUTE,
    "both group cards created by the orchestrator",
  );
  assert.deepEqual(groups.map((c) => c.id).sort(), [ALPHA_ID, BETA_ID]);
  assert.equal(groups.find((c) => c.id === ALPHA_ID)?.title, "Alpha group");
  note("both groups created");

  await waitFor(
    async () => {
      const a = await cardOf(sb, BOARD, ALPHA_ID);
      const b = await cardOf(sb, BOARD, BETA_ID);
      return a?.tmuxSession !== undefined && b?.tmuxSession !== undefined;
    },
    4 * MINUTE,
    "both group sessions started",
  );

  await waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, BETA_ID);
      return card?.loopProgress?.units[0]?.phases[0]?.gate === "pass";
    },
    4 * MINUTE,
    "group B phase 1 pass on the board",
  );
  note("group B passed phase 1, showing the usage limit menu");
  fs.writeFileSync(betaFile, JSON.stringify(betaBody(limitMenuFields())));

  const stopped = await waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, BETA_ID);
      return card?.state === "needs_input" && card.stateReason === "usage_stop"
        ? card
        : null;
    },
    4 * MINUTE,
    "group B at needs_input with usage_stop",
  );
  assert.equal(stopped.column, "needs_input");
  note("usage stop recorded");
  const dialogKeys = readJsonl(betaPaths.keyLog);
  const enters = dialogKeys.filter((k) => k.key === "enter");
  assert.ok(enters.length >= 1, "the supervisor pressed Enter on the menu");
  for (const enter of enters) {
    assert.equal(enter.row, STOP_ROW);
    assert.notEqual(enter.row, CREDITS_ROW);
  }
  const answered = actionsOf(
    await sb.orchestrationEvents(BOARD),
    "limit_answer",
    BETA_ID,
  );
  assert.equal(answered[0]?.data.result, "answered");

  fs.writeFileSync(betaFile, JSON.stringify(betaBody()));
  await sleep(1500);
  const resumed = await sb.api<{ result: string }>(
    "POST",
    `/api/sessions/${BETA_ID}/resume-loop`,
  );
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.result, "confirmed");
  note("resume loop confirmed");

  await waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, BETA_ID);
      return card?.loopProgress?.units[0]?.phases[2]?.gate === "pass";
    },
    4 * MINUTE,
    "group B phase 3 pass after the resume",
  );
  const betaAfter = await cardOf(sb, BOARD, BETA_ID);
  assert.notEqual(betaAfter?.stateReason, "usage_stop");

  const handoff = await waitFor(
    async () => {
      const rows = actionsOf(
        await sb.orchestrationEvents(BOARD),
        "handoff",
        ALPHA_ID,
      );
      return rows.find((e) => e.data.result === "confirmed");
    },
    6 * MINUTE,
    "a confirmed handoff action for group A",
    { pollMs: 1000 },
  );
  const requests = actionsOf(
    await sb.orchestrationEvents(BOARD),
    "handoff_request",
    ALPHA_ID,
  );
  assert.equal(requests[0]?.data.result, "confirmed");
  assert.equal(requests[0]?.data.contextPercent, 55);
  const engineFile = ["ralph-loop.local.md", "ralph-loop.local.md.done"]
    .map((name) => path.join(alphaWs, ".claude", name))
    .find((file) => fs.existsSync(file));
  assert.ok(engineFile, "the engine file exists, closed or not");
  const engine = fs.readFileSync(engineFile, "utf8");
  const sessionId = /^session_id: (.*)$/m.exec(engine)?.[1];
  assert.equal(sessionId, handoff.data.sessionId);
  assert.notEqual(sessionId, "handoff-pending");
  assert.notEqual(sessionId, "s1-alpha-original");
  assert.match(String(sessionId), /-fresh$/);
  assert.ok(
    fs.existsSync(
      path.join(transcriptDirOf(sb.home, alphaWs), `${sessionId}.jsonl`),
    ),
  );
  note("handoff confirmed with a new session id");

  const failed = await failedGateSeen;
  assert.deepEqual(
    { phase: failed.phase, result: failed.result },
    { phase: 2, result: "fail" },
  );
  note("failed gate seen on the board");

  await waitFor(
    async () => {
      const unit = (await cardOf(sb, BOARD, ALPHA_ID))?.loopProgress?.units[0];
      return (
        unit?.phases[1]?.gate === "pass" &&
        unit.phases[2]?.gate === "pass" &&
        unit.status === "built, awaiting /ship"
      );
    },
    4 * MINUTE,
    "group A phases 2 and 3 pass",
  );
  const lastGate = (await cardOf(sb, BOARD, ALPHA_ID))?.loopProgress?.summary
    .lastGate;
  assert.equal(lastGate?.result, "pass");
  note("failed gate cleared by a later pass");

  for (const id of [ALPHA_ID, BETA_ID]) {
    await waitFor(
      async () => {
        const progress = (await cardOf(sb, BOARD, id))?.loopProgress;
        return progress?.completion === "complete" && progress.engine?.closed;
      },
      4 * MINUTE,
      `${id} complete with its engine file closed`,
    );
  }
  const closes = actionsOf(await sb.orchestrationEvents(BOARD), "close_loop");
  assert.equal(closes.length, 2);
  note("both loops complete");

  const wakesBefore = (await sb.orchestrationEvents(BOARD)).filter(
    (e) => e.kind === "machine_wake",
  ).length;
  note("pausing the server for 100 s");
  await sb.pause(100_000);
  const wakes = await waitFor(
    async () => {
      const rows = (await sb.orchestrationEvents(BOARD)).filter(
        (e) => e.kind === "machine_wake",
      );
      return rows.length > wakesBefore ? rows : null;
    },
    3 * MINUTE,
    "a machine_wake event after the pause",
    { pollMs: 1000 },
  );
  assert.equal(wakes.length, wakesBefore + 1);
  assert.equal(wakes.at(-1)?.boardKey, BOARD);
  assert.ok(Number(wakes.at(-1)?.data.sleptSeconds) >= 30);
  note("machine wake recorded");

  const open = await sb.api<{ items: { id: string; question: string }[] }>(
    "GET",
    `/api/decisions?board=${BOARD}&state=open`,
  );
  const gate = open.body.items.find((i) => i.question.includes("Ship them"));
  assert.ok(gate, "the orchestrator raised the ship decision item");
  const gateAnswer = await sb.api("POST", `/api/decisions/${gate.id}/answer`, {
    optionId: "ship",
  });
  assert.equal(gateAnswer.status, 200);

  for (const id of [ALPHA_ID, BETA_ID]) {
    await waitFor(
      async () => (await cardOf(sb, BOARD, id))?.shipFlow?.state === "done",
      8 * MINUTE,
      `${id} ship flow done`,
    );
  }
  note("both ship flows done");
  const calls = readJsonl(sb.gh.log).map((argv) =>
    Array.isArray(argv) ? argv.map(String) : [],
  );
  const verbs = (verb: string) =>
    calls.filter((c) => c[0] === "pr" && c[1] === verb);
  assert.equal(verbs("create").length, 2);
  assert.equal(verbs("merge").length, 2);
  assert.deepEqual(mainSubjects(sample, sb.home), [
    "feat: beta unit (#2)",
    "feat: alpha unit (#1)",
    "chore: initial commit",
  ]);

  const replay = await waitFor(
    () => {
      const lines = readJsonl(orchestratorLog);
      return lines.at(-1)?.done === true ? lines : null;
    },
    4 * MINUTE,
    "the orchestrator replay to finish its steps",
    { pollMs: 1000 },
  );
  const tools = replay.filter((l) => l.tool !== undefined);
  assert.ok(tools.length >= 10);
  for (const line of tools)
    assert.equal(line.expectMet, true, JSON.stringify(line));
  assert.equal(replay.at(-1)?.done, true);
  assert.equal(replay.at(-1)?.stopped, undefined);
}

/** Resolve with the first failed gate that the board shows for group A. */
function watchFailedGate(sb: Sandbox, signal: AbortSignal) {
  return waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, ALPHA_ID).catch(() => undefined);
      const gate = card?.loopProgress?.summary.lastGate;
      return gate?.result === "fail" ? gate : null;
    },
    14 * MINUTE,
    "a failed gate for group A on the board",
    { pollMs: 400, signal },
  );
}

/** Assert that the events hold each kind of supervisor action and each orchestrator tool of the scenario. */
function assertScenarioCoverage(events: OrchestrationEventRow[]): void {
  const actions = new Set(
    events
      .filter((e) => e.kind === "supervisor_action")
      .map((e) => e.data.action),
  );
  for (const action of [
    "handoff_request",
    "handoff",
    "limit_answer",
    "needs_input",
    "close_loop",
  ]) {
    assert.ok(actions.has(action), `supervisor action ${action} was recorded`);
  }
  const tools = new Set(
    events.filter((e) => e.kind === "tool_call").map((e) => e.data.tool),
  );
  for (const tool of [
    "read_state",
    "get_policy",
    "list_cards",
    "create_group",
    "start_group",
    "create_decision_item",
    "wait_for_event",
    "start_ship",
    "get_ship_state",
    "write_state",
  ]) {
    assert.ok(tools.has(tool), `orchestrator tool ${tool} was recorded`);
  }
  assert.ok(
    events.some((e) => e.kind === "machine_wake"),
    "the machine wake was recorded",
  );
}

void test("scenario 1: the harness and fixtures name no tmux verb that sends keys", () => {
  const here = path.dirname(import.meta.filename);
  const fixtures = path.join(here, "fixtures", "scenario-1");
  const files = [
    path.join(here, "harness", "sandbox.ts"),
    ...fs
      .readdirSync(here)
      .filter((f) => f.endsWith(".e2e.ts"))
      .map((f) => path.join(here, f)),
    ...fs.readdirSync(fixtures).map((f) => path.join(fixtures, f)),
  ];
  for (const file of files) {
    assert.doesNotMatch(
      fs.readFileSync(file, "utf8"),
      /send-ke[y]s|paste-buffe[r]|load-buffe[r]/,
      `${file} sends no key to a pane`,
    );
  }
});

void test(
  "scenario 1: an orchestrated board runs a handoff, a usage stop, a failed gate, a machine sleep and a ship",
  { timeout: 25 * MINUTE },
  async () => {
    const sb = await startSandbox({ name: "s1-orchestrated" });
    const watcher = new AbortController();
    try {
      assert.ok(sb.port >= PORT_FIRST && sb.port <= PORT_LAST);
      for (const refused of [4700, 4710, 47990, 5291, 48900]) {
        assert.throws(() => assertSafePort(refused), /refused/);
      }
      assert.throws(
        () => sb.tmux([["send", "keys"].join("-"), "-t", "x", "a"]),
        /only reads/,
      );
      await runScenario(sb, watcher);
      const events = await writeRunLog(sb, BOARD, RUN_LOG);
      assertScenarioCoverage(events);
    } finally {
      watcher.abort();
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
