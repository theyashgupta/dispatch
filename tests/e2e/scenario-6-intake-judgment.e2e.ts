import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Card } from "../../src/shared/types.js";
import {
  FEATURE_PLAYBOOK,
  GROUP_PLAYBOOK,
  QUICK_FIX_PLAYBOOK,
  orchestratorScenario,
} from "./fixtures/scenario-6/orchestrator.js";
import { makeSampleRepo } from "./fixtures/scenario-1/repo.js";
import { readyRows } from "./fixtures/scenario-1/status-rows.js";
import { cardOf, readJsonl, writeRunLog } from "./harness/board-reads.js";
import {
  EVIDENCE_DIR,
  MINUTE,
  makeNote,
  sleep,
  startSandbox,
  waitFor,
  type OrchestrationEventRow,
  type Sandbox,
} from "./harness/sandbox.js";

const BOARD = "JDG";
const QUICK_FIX = "JDG-1";
const FEATURE = "JDG-2";
const RELATED = ["JDG-3", "JDG-4"];
const ORCHESTRATOR_CARD = "JDG-5";
const GROUP_ID = "JDG-6";
const CAP = 2;
const RUN_LOG = path.join(EVIDENCE_DIR, "scenario-6-run-log.txt");
const DONE_MESSAGE = "DISPATCH_STATUS: DONE - quick fix built";

const note = makeNote("scenario-6");

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

const isToolRow = (e: OrchestrationEventRow, tool: string): boolean =>
  e.kind === "tool_call" && e.data.tool === tool;

const isAccepted = (e: OrchestrationEventRow): boolean =>
  typeof e.data.status === "number" && e.data.status < 400;

/** The cards that hold a cap slot: a group or a launched card with a live session that is not in Agent done. */
const slotHolders = (cards: Card[]): Card[] =>
  cards.filter(
    (c) =>
      (c.source === "group" || c.launch !== undefined) &&
      c.tmuxSession !== undefined &&
      c.column !== "agent_done",
  );

interface CapWatch {
  stop: () => Promise<number>;
}

/**
 * Poll the board every 300 ms and keep the highest count of slot holders that it saw.
 *
 * @remarks The orchestrator calls are seconds apart, so a poll lands after every `tool_call` row and the highest
 * count covers the state after each row. `stop` ends the watcher and answers that count.
 */
function watchCap(sb: Sandbox): CapWatch {
  let running = true;
  let highest = 0;
  const loop = (async () => {
    while (running) {
      try {
        const board = await sb.api<{ cards: Card[] }>(
          "GET",
          `/api/board?board=${BOARD}`,
        );
        highest = Math.max(highest, slotHolders(board.body.cards).length);
      } catch {
        highest = Math.max(highest, 0);
      }
      await sleep(300);
    }
  })();
  return {
    stop: async () => {
      running = false;
      await loop;
      return highest;
    },
  };
}

async function setup(sb: Sandbox): Promise<{ replayLog: string }> {
  const sample = makeSampleRepo(sb.root, sb.home);
  const sessions = path.join(sb.workspaces, "jdg-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Judgment board",
    workspaceRoot: sessions,
    repositories: [
      { path: sample.repo, baseBranch: "main", checkCommand: "true" },
    ],
  });
  assert.equal(board.status, 201);
  const policy = await sb.api("PUT", `/api/boards/${BOARD}/policy`, {
    roadmapApproval: "ask",
    concurrencyCap: CAP,
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
  const tickets: string[] = [];
  const specs = [
    ["Fix the typo in the footer", "One known fix of a few lines."],
    ["Add the export button", "One feature of one module."],
    ["Add the report model", "First of two related tickets."],
    ["Add the report page", "Second of two related tickets, same files."],
  ];
  for (const [title, description] of specs) {
    const made = await sb.api<{ id: string }>(
      "POST",
      `/api/cards?board=${BOARD}`,
      { title, description },
    );
    assert.equal(made.status, 201);
    tickets.push(made.body.id);
  }
  assert.deepEqual(tickets, [QUICK_FIX, FEATURE, ...RELATED]);
  const added = await sb.api("POST", `/api/boards/${BOARD}/orchestrators`, {
    id: "main",
    name: "Main",
    role: "main",
  });
  assert.equal(added.status, 201);

  const replayLog = path.join(sb.logs, "orchestrator-replay.log");
  fs.writeFileSync(
    path.join(sb.scenarios, `${ORCHESTRATOR_CARD}.json`),
    JSON.stringify(
      orchestratorScenario({
        repo: sample.repo,
        quickFix: QUICK_FIX,
        feature: FEATURE,
        related: RELATED,
        groupTitle: "Report group",
        replayLog,
        waits: 24,
      }),
    ),
  );
  for (const id of [QUICK_FIX, FEATURE, GROUP_ID]) {
    fs.writeFileSync(
      path.join(sb.scenarios, `${id}.json`),
      JSON.stringify({ statusRows: readyRows(), reply: "ok" }),
    );
  }
  return { replayLog };
}

async function approvePlan(sb: Sandbox): Promise<void> {
  const start = await sb.api(
    "POST",
    `/api/boards/${BOARD}/orchestrators/main/start`,
  );
  assert.equal(start.status, 202);
  note("orchestrator started");

  const item = await waitFor(
    async () => {
      const open = await sb.api<{ items: { id: string; question: string }[] }>(
        "GET",
        `/api/decisions?board=${BOARD}&state=open`,
      );
      return open.body.items.find((i) => i.question.includes("Approve this"));
    },
    4 * MINUTE,
    "the plan decision item",
  );
  for (const expected of [
    `${QUICK_FIX} alone, ${QUICK_FIX_PLAYBOOK}`,
    `${FEATURE} alone, ${FEATURE_PLAYBOOK}`,
    `${RELATED.join(" and ")} as one group, ${GROUP_PLAYBOOK}`,
  ]) {
    assert.ok(item.question.includes(expected), item.question);
  }
  const answer = await sb.api("POST", `/api/decisions/${item.id}/answer`, {
    optionId: "approve",
  });
  assert.equal(answer.status, 200);
  note("plan approved");
}

/** Wait for a ticket card to carry a live session, the sign that its start finished. */
const awaitSession = (sb: Sandbox, id: string): Promise<Card> =>
  waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, id);
      return card?.tmuxSession !== undefined ? card : null;
    },
    4 * MINUTE,
    `the session of ${id}`,
  );

async function assertGroupRefused(sb: Sandbox): Promise<void> {
  const refused = await waitFor(
    async () =>
      (await sb.orchestrationEvents(BOARD)).find(
        (e) => isToolRow(e, "start_group") && e.data.status === 403,
      ),
    4 * MINUTE,
    "the refused start_group row",
  );
  assert.equal(refused.data.result, "policy-refused");
  assert.equal(refused.cardId, GROUP_ID);
  const group = await cardOf(sb, BOARD, GROUP_ID);
  assert.equal(group?.source, "group");
  assert.equal(
    group?.tmuxSession,
    undefined,
    "the refused group has no session",
  );
  note("first start_group refused with the group not started");
}

async function finishQuickFix(sb: Sandbox, quickFix: Card): Promise<void> {
  await sendStopHook(sb, quickFix.tmuxSession ?? "", DONE_MESSAGE);
  await waitFor(
    async () => (await cardOf(sb, BOARD, QUICK_FIX))?.column === "agent_done",
    4 * MINUTE,
    "the quick fix card in agent_done",
  );
  note("quick fix reached agent_done");
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
  note("replay finished");
  const tools = replay.filter((l) => l.tool !== undefined);
  assert.ok(tools.length >= 12);
  for (const line of tools)
    assert.equal(line.expectMet, true, JSON.stringify(line));
  assert.equal(replay.at(-1)?.stopped, undefined);
}

async function assertStarts(sb: Sandbox): Promise<void> {
  const events = await sb.orchestrationEvents(BOARD);
  const starts = events.filter(
    (e) =>
      (isToolRow(e, "start_card") || isToolRow(e, "start_group")) &&
      isAccepted(e),
  );
  assert.deepEqual(
    starts.map((e) => [e.data.tool, e.cardId]),
    [
      ["start_card", QUICK_FIX],
      ["start_card", FEATURE],
      ["start_group", GROUP_ID],
    ],
  );
  const refused = events.filter(
    (e) => isToolRow(e, "start_group") && !isAccepted(e),
  );
  assert.equal(refused.length, 1);
  assert.equal(refused[0]?.data.status, 403);

  const quickFix = await cardOf(sb, BOARD, QUICK_FIX);
  assert.equal(quickFix?.startIntent?.playbook, QUICK_FIX_PLAYBOOK);
  assert.equal(quickFix?.launch?.playbook, QUICK_FIX_PLAYBOOK);
  const feature = await cardOf(sb, BOARD, FEATURE);
  assert.equal(feature?.startIntent?.playbook, FEATURE_PLAYBOOK);
  assert.equal(feature?.launch?.playbook, FEATURE_PLAYBOOK);
  const group = await awaitSession(sb, GROUP_ID);
  assert.equal(group.launch?.playbook, GROUP_PLAYBOOK);
  note("second start_group started the group");
}

/**
 * Run a board whose orchestrator reads the rule book, asks for a plan, and starts three loops inside a cap of 2.
 *
 * @remarks The only inputs after the start are HTTP calls (the plan answer and the Stop hook of the quick fix session).
 * The group start is refused while the two cards run, and succeeds after the quick fix reaches Agent done.
 */
async function runScenario(sb: Sandbox): Promise<void> {
  const { replayLog } = await setup(sb);
  const watch = watchCap(sb);
  try {
    await approvePlan(sb);
    const quickFix = await awaitSession(sb, QUICK_FIX);
    await awaitSession(sb, FEATURE);
    note("both cards started");
    await assertGroupRefused(sb);
    await finishQuickFix(sb, quickFix);
    await assertReplay(replayLog);
    await assertStarts(sb);
  } finally {
    const highest = await watch.stop();
    note(`most loops at once: ${highest}`);
    assert.ok(highest <= CAP, `${highest} loops held a slot at once`);
  }
}

void test(
  "scenario 6: the orchestrator judges four tickets into three starts inside a cap of 2",
  { timeout: 20 * MINUTE },
  async () => {
    const sb = await startSandbox({ name: "s6-intake-judgment" });
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

void test("scenario 6 code types no key into any pane", () => {
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
    path.join(import.meta.dirname, "fixtures/scenario-6/orchestrator.ts"),
  ];
  for (const file of files) {
    assert.equal(typing.test(fs.readFileSync(file, "utf8")), false, file);
  }
});
