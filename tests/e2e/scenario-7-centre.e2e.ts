import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type {
  Card,
  DecisionItem,
  OrchestratorConversation,
  OrchestratorView,
} from "../../src/shared/types.js";
import { centreGraph } from "../../src/web/modules/orchestrator/domain/centre-graph.js";
import { conversationView } from "../../src/web/modules/orchestrator/domain/conversation-view.js";
import {
  FEATURE_PLAYBOOK,
  ORCHESTRATOR_REPLY,
  QUICK_FIX_PLAYBOOK,
  centreScenario,
} from "./fixtures/scenario-7/orchestrator.js";
import { makeSampleRepo } from "./fixtures/scenario-1/repo.js";
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

const BOARD = "CEN";
const QUICK_FIX = "CEN-1";
const FEATURE = "CEN-2";
const ORCHESTRATOR_CARD = "CEN-3";
const COMMENT = "Start CEN-1 first, it unblocks the release.";
const RUN_LOG = path.join(EVIDENCE_DIR, "scenario-7-run-log.txt");

const note = makeNote("scenario-7");

interface Setup {
  replayLog: string;
  transcript: string;
}

async function setup(sb: Sandbox): Promise<Setup> {
  const sample = makeSampleRepo(sb.root, sb.home);
  const sessions = path.join(sb.workspaces, "cen-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Centre board",
    workspaceRoot: sessions,
    repositories: [
      { path: sample.repo, baseBranch: "main", checkCommand: "true" },
    ],
  });
  assert.equal(board.status, 201);
  const policy = await sb.api("PUT", `/api/boards/${BOARD}/policy`, {
    roadmapApproval: "ask",
    concurrencyCap: 2,
    loopModel: "claude-sonnet-5-5:high",
    orchestratorModel: "claude-sonnet-5-5",
    handoffPercent: 50,
    handoffHardPercent: 80,
    usageLimit: "stop",
    shipRights: "none",
    budgetPerGroup: null,
    supervisor: "on",
    groupPlaybook: null,
  });
  assert.equal(policy.status, 200);
  for (const [title, description] of [
    ["Fix the typo in the footer", "One known fix of a few lines."],
    ["Add the export button", "One feature of one module."],
  ]) {
    const made = await sb.api("POST", `/api/cards?board=${BOARD}`, {
      title,
      description,
    });
    assert.equal(made.status, 201);
  }
  const added = await sb.api("POST", `/api/boards/${BOARD}/orchestrators`, {
    id: "main",
    name: "Main",
    role: "main",
  });
  assert.equal(added.status, 201);

  const projects = path.join(sb.home, ".claude", "projects", "cen-centre");
  fs.mkdirSync(projects, { recursive: true });
  const transcript = path.join(projects, "orchestrator.jsonl");
  fs.writeFileSync(transcript, "");
  const replayLog = path.join(sb.logs, "orchestrator-replay.log");
  fs.writeFileSync(
    path.join(sb.scenarios, `${ORCHESTRATOR_CARD}.json`),
    JSON.stringify(
      centreScenario({
        quickFix: QUICK_FIX,
        feature: FEATURE,
        transcriptPath: transcript,
        replayLog,
        waits: 12,
      }),
    ),
  );
  for (const id of [QUICK_FIX, FEATURE]) {
    fs.writeFileSync(
      path.join(sb.scenarios, `${id}.json`),
      JSON.stringify({ statusRows: readyRows(), reply: "ok" }),
    );
  }
  return { replayLog, transcript };
}

/** Report the transcript file of the orchestrator session by hook, the way a real Claude session does at start. */
async function reportTranscript(
  sb: Sandbox,
  transcript: string,
): Promise<void> {
  const session = await waitFor(
    () => {
      const names = sb
        .tmux(["list-sessions", "-F", "#{session_name}"])
        .split("\n")
        .filter((n) => n !== "");
      return names.find(
        (n) =>
          sb
            .tmux(["show-environment", "-t", `=${n}`, "DISPATCH_CARD_ID"])
            .trim() === `DISPATCH_CARD_ID=${ORCHESTRATOR_CARD}`,
      );
    },
    MINUTE,
    "the tmux session of the orchestrator card",
  );
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
      hook_event_name: "SessionStart",
      session_id: "orchestrator",
      transcript_path: transcript,
    }),
  });
  assert.equal(res.status, 204);
}

interface CentreReads {
  cards: Card[];
  records: OrchestratorView[];
  decisions: DecisionItem[];
  conversation: OrchestratorConversation;
}

async function readCentre(sb: Sandbox): Promise<CentreReads> {
  const board = await sb.api<{ cards: Card[] }>(
    "GET",
    `/api/board?board=${BOARD}`,
  );
  const records = await sb.api<{ orchestrators: OrchestratorView[] }>(
    "GET",
    `/api/boards/${BOARD}/orchestrators`,
  );
  const decisions = await sb.api<{ items: DecisionItem[] }>(
    "GET",
    `/api/decisions?board=${BOARD}`,
  );
  const conversation = await sb.api<OrchestratorConversation>(
    "GET",
    `/api/boards/${BOARD}/orchestrators/main/conversation`,
  );
  assert.equal(conversation.status, 200);
  return {
    cards: board.body.cards,
    records: records.body.orchestrators,
    decisions: decisions.body.items,
    conversation: conversation.body,
  };
}

const graphOf = (reads: CentreReads) =>
  centreGraph({
    cards: reads.cards,
    records: reads.records,
    selectedId: null,
    decisions: reads.decisions,
    now: Date.now(),
    showOlderShipped: false,
  });

const timelineOf = (reads: CentreReads) =>
  conversationView({
    messages: reads.conversation.messages,
    decisions: reads.decisions,
    orchestratorId: "main",
    orchestratorName: "Main",
    orchestratorNames: new Map([["main", "Main"]]),
    now: Date.now(),
  });

async function assertPlanProposed(sb: Sandbox): Promise<string> {
  const reads = await waitFor(
    async () => {
      const r = await readCentre(sb);
      const open = r.decisions.some(
        (d) => d.kind === "plan" && d.state === "open",
      );
      const replied = r.conversation.messages.some(
        (m) => m.role === "orchestrator" && m.text === ORCHESTRATOR_REPLY,
      );
      return open && replied ? r : null;
    },
    4 * MINUTE,
    "the open plan decision and the first orchestrator reply",
  );
  assert.equal(reads.conversation.status, "ok");
  assert.equal(reads.conversation.messages[0]?.role, "system");
  const plan = timelineOf(reads).find(
    (e) => e.kind === "decision" && e.decisionKind === "plan",
  );
  assert.ok(plan?.kind === "decision");
  assert.deepEqual(
    plan.view.planRows.map((r) => [r.ref, r.playbook, r.order, r.size]),
    [
      [QUICK_FIX, QUICK_FIX_PLAYBOOK, 1, "small"],
      [FEATURE, FEATURE_PLAYBOOK, 2, "medium"],
    ],
  );
  assert.equal(plan.view.otherOptionId, null);
  const graph = graphOf(reads);
  assert.deepEqual(
    graph.bands[2]?.branches.map((b) => [b.id, b.slot, b.playbook]),
    [
      [QUICK_FIX, 0, QUICK_FIX_PLAYBOOK],
      [FEATURE, 1, FEATURE_PLAYBOOK],
    ],
  );
  assert.equal(graph.bands[1]?.count, 0);
  note("plan proposed: two planned branches in plan order");
  return plan.id;
}

async function assertCommentReaches(sb: Sandbox): Promise<void> {
  const sent = await sb.api<{ result: string }>(
    "POST",
    `/api/sessions/${ORCHESTRATOR_CARD}/input`,
    { text: COMMENT },
  );
  assert.equal(sent.status, 200);
  const reads = await waitFor(
    async () => {
      const r = await readCentre(sb);
      return r.conversation.messages.some(
        (m) => m.role === "user" && m.text === COMMENT,
      )
        ? r
        : null;
    },
    2 * MINUTE,
    "the comment as a user message",
  );
  const messages = reads.conversation.messages;
  const index = messages.findIndex((m) => m.text === COMMENT);
  assert.equal(messages[index + 1]?.role, "orchestrator");
  assert.equal(messages[index + 1]?.text, ORCHESTRATOR_REPLY);
  note(`comment delivered (${sent.body.result}) and answered`);
}

async function assertBranchesStart(sb: Sandbox): Promise<void> {
  for (const id of [QUICK_FIX, FEATURE]) {
    await waitFor(
      async () => (await cardOf(sb, BOARD, id))?.tmuxSession !== undefined,
      4 * MINUTE,
      `the session of ${id}`,
    );
  }
  const graph = graphOf(await readCentre(sb));
  assert.deepEqual(
    graph.bands[1]?.branches.map((b) => [b.id, b.slot, b.playbook, b.state]),
    [
      [QUICK_FIX, 0, QUICK_FIX_PLAYBOOK, "running"],
      [FEATURE, 1, FEATURE_PLAYBOOK, "running"],
    ],
  );
  assert.equal(graph.bands[2]?.count, 0);
  note("both branches running in the same slots");
}

async function assertReplay(replayLog: string): Promise<void> {
  const replay = await waitFor(
    () => {
      const lines = readJsonl(replayLog);
      return lines.at(-1)?.done === true ? lines : null;
    },
    8 * MINUTE,
    "the orchestrator replay to finish its steps",
    { pollMs: 1000 },
  );
  for (const line of replay.filter((l) => l.tool !== undefined))
    assert.equal(line.expectMet, true, JSON.stringify(line));
}

/**
 * Run a board whose orchestrator proposes a plan, gets a comment and an approval, and starts both planned cards.
 *
 * @remarks The inputs after the start are HTTP calls only: the hook that reports the transcript, the comment through
 * the session input route, and the plan answer. The centre view models run on the real route reads.
 */
async function runScenario(sb: Sandbox): Promise<void> {
  const { replayLog, transcript } = await setup(sb);
  const start = await sb.api(
    "POST",
    `/api/boards/${BOARD}/orchestrators/main/start`,
  );
  assert.equal(start.status, 202);
  await reportTranscript(sb, transcript);
  const planId = await assertPlanProposed(sb);
  await assertCommentReaches(sb);
  const answer = await sb.api("POST", `/api/decisions/${planId}/answer`, {
    optionId: "approve",
  });
  assert.equal(answer.status, 200);
  note("plan approved");
  await assertBranchesStart(sb);
  await assertReplay(replayLog);
}

void test(
  "scenario 7: a plan in the conversation, a comment, an approval, then the branches start",
  { timeout: 20 * MINUTE },
  async () => {
    const sb = await startSandbox({ name: "s7-centre" });
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

void test("scenario 7 code types no key into any pane", () => {
  const typing = new RegExp(
    [
      ["send", "keys"].join("-?"),
      ["send", "Literal"].join(""),
      ["paste", "buffer"].join("-"),
      ["load", "buffer"].join("-"),
    ].join("|"),
    "i",
  );
  const files = [
    import.meta.filename,
    path.join(import.meta.dirname, "fixtures/scenario-7/orchestrator.ts"),
  ];
  for (const file of files) {
    assert.equal(typing.test(fs.readFileSync(file, "utf8")), false, file);
  }
});
