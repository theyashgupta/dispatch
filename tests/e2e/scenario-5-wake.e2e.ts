import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Card } from "../../src/shared/types.js";
import {
  isBusy,
  orchestratorScenario,
} from "./fixtures/scenario-5/orchestrator.js";
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
  type OrchestrationEventRow,
  type Sandbox,
} from "./harness/sandbox.js";

const BOARD = "WAK";
const GROUP_ID = "WAK-4";
const ORCHESTRATOR_CARD = "WAK-3";
const RUN_LOG = path.join(EVIDENCE_DIR, "scenario-5-run-log.txt");
const MERGED_SUBJECT = "feat: woken group (#1)";
const DONE_MESSAGE = "DISPATCH_STATUS: DONE - built";
const WAKE_PREFIX = "Dispatch wake:";
const MAX_WAKE_SECONDS = 30;
const WAKE_GAP_MS = 20_000;

const note = makeNote("scenario-5");

interface Span {
  from: number;
  to: number;
}

interface Received {
  text: string;
  at: number;
}

/**
 * Post one hook event the way a real session does, with the token read from the tmux session environment.
 *
 * @remarks The sandbox uses the hooks status channel, so a hook is the only way a fake session reports its
 * transcript file or its end of turn. A hook is an HTTP call and never reaches the pane.
 */
async function postHook(
  sb: Sandbox,
  session: string,
  body: Record<string, unknown>,
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
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 204);
}

const worktreeOf = (card: Card, sample: SampleRepo): string =>
  path.join(card.workspacePath ?? "", sample.name);

/** The lines that reached the fake orchestrator as user turns, read from the transcript the fake writes. */
function receivedLines(transcript: string): Received[] {
  return readJsonl(transcript)
    .filter((e) => e.type === "user")
    .map((e) => ({
      text: String((e.message as { content: unknown }).content),
      at: Date.parse(String(e.timestamp)),
    }));
}

const wakeLines = (transcript: string): Received[] =>
  receivedLines(transcript).filter((l) => l.text.startsWith(WAKE_PREFIX));

const wakeRows = (events: OrchestrationEventRow[]): OrchestrationEventRow[] =>
  events.filter(
    (e) =>
      e.kind === "supervisor_action" && e.data.action === "orchestrator_wake",
  );

/** The spans in which the fake orchestrator showed busy status rows, read from its status log. */
function busyWindows(statusLog: string): Span[] {
  const rows = readJsonl(statusLog);
  const windows: Span[] = [];
  rows.forEach((row, i) => {
    if (!isBusy(row.rows)) return;
    const next = rows[i + 1];
    windows.push({
      from: Date.parse(String(row.at)),
      to: next === undefined ? Infinity : Date.parse(String(next.at)),
    });
  });
  return windows;
}

const insideAny = (windows: Span[], at: number): boolean =>
  windows.some((w) => at >= w.from && at < w.to);

/** Create the board, policy, two tickets and the main orchestrator, and write the replay files. */
async function setup(sb: Sandbox): Promise<{
  sample: SampleRepo;
  replayLog: string;
  statusLog: string;
  transcript: string;
}> {
  const sample = makeSampleRepo(sb.root, sb.home);
  const sessions = path.join(sb.workspaces, "wak-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Wake board",
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
  assert.deepEqual(tickets, ["WAK-1", "WAK-2"]);
  const added = await sb.api("POST", `/api/boards/${BOARD}/orchestrators`, {
    id: "main",
    name: "Main",
    role: "main",
  });
  assert.equal(added.status, 201);

  const replayLog = path.join(sb.logs, "orchestrator-replay.log");
  const statusLog = path.join(sb.logs, "orchestrator-status.log");
  const projects = path.join(
    sb.home,
    ".claude",
    "projects",
    "wak-orchestrator",
  );
  fs.mkdirSync(projects, { recursive: true });
  const transcript = path.join(projects, "orchestrator.jsonl");
  fs.writeFileSync(transcript, "");
  fs.writeFileSync(
    path.join(sb.scenarios, `${ORCHESTRATOR_CARD}.json`),
    JSON.stringify(
      orchestratorScenario({
        repo: sample.repo,
        members: tickets,
        title: "Woken group",
        replayLog,
        statusLog,
        transcriptPath: transcript,
      }),
    ),
  );
  fs.writeFileSync(
    path.join(sb.scenarios, `${GROUP_ID}.json`),
    JSON.stringify({ statusRows: readyRows(), reply: "ok" }),
  );
  return { sample, replayLog, statusLog, transcript };
}

/** Start the orchestrator, report its transcript file by hook, and wait for the group and the decision item. */
async function startAndAwaitDecision(
  sb: Sandbox,
  transcript: string,
): Promise<{ group: Card; decisionId: string }> {
  const start = await sb.api<{ cardId: string }>(
    "POST",
    `/api/boards/${BOARD}/orchestrators/main/start`,
  );
  assert.equal(start.status, 202);
  note("orchestrator started");

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
  await postHook(sb, session, {
    hook_event_name: "SessionStart",
    session_id: "orchestrator",
    transcript_path: transcript,
  });
  note("orchestrator transcript reported");

  const group = await waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, GROUP_ID);
      return card?.source === "group" && card.tmuxSession !== undefined
        ? card
        : null;
    },
    4 * MINUTE,
    "the group card created and started by the orchestrator",
  );
  const item = await waitFor(
    async () => {
      const open = await sb.api<{ items: { id: string; question: string }[] }>(
        "GET",
        `/api/decisions?board=${BOARD}&state=open`,
      );
      return open.body.items.find((i) =>
        i.question.includes("Start the build"),
      );
    },
    2 * MINUTE,
    "the decision item of the orchestrator",
  );
  return { group, decisionId: item.id };
}

/** Commit on the group branch, print the done marker in the group pane and send the Stop hook. */
async function finishGroup(
  sb: Sandbox,
  sample: SampleRepo,
  group: Card,
): Promise<void> {
  const worktree = worktreeOf(group, sample);
  assert.equal(
    git(worktree, sb.home, ["rev-parse", "--abbrev-ref", "HEAD"]),
    GROUP_ID,
  );
  fs.writeFileSync(path.join(worktree, "feature.txt"), "woken group work\n");
  git(worktree, sb.home, ["add", "feature.txt"]);
  git(worktree, sb.home, ["commit", "-q", "-m", "feat: woken group work"]);
  fs.writeFileSync(
    path.join(sb.scenarios, `${GROUP_ID}.json`),
    JSON.stringify({
      statusRows: readyRows(),
      reply: "ok",
      transcript: ["● built both tickets", DONE_MESSAGE],
    }),
  );
  await postHook(sb, group.tmuxSession ?? "", {
    hook_event_name: "Stop",
    last_assistant_message: DONE_MESSAGE,
  });
}

/**
 * Run the two wakes: a decision answer, then Agent done, and check the orchestrator ships the group.
 *
 * @remarks The group finishes only after the orchestrator read the events, because a group event that `list_events`
 * returned is never a wake reason. The only inputs after the start are HTTP calls (the answer route and the hook posts), git commands in
 * the group worktree and a scenario file rewrite. No key is typed into a pane.
 */
async function runScenario(sb: Sandbox): Promise<void> {
  const { sample, replayLog, statusLog, transcript } = await setup(sb);
  const { group, decisionId } = await startAndAwaitDecision(sb, transcript);
  note("group started and decision open");

  const answeredAt = Date.now();
  const answer = await sb.api("POST", `/api/decisions/${decisionId}/answer`, {
    optionId: "go",
  });
  assert.equal(answer.status, 200);

  const first = await waitFor(
    () => wakeLines(transcript)[0],
    MINUTE,
    "the decision wake line",
  );
  const seconds = (first.at - answeredAt) / 1000;
  note(`decision wake line ${seconds.toFixed(1)}s after the answer`);
  assert.ok(
    seconds <= MAX_WAKE_SECONDS,
    `the wake line came ${seconds}s after the answer`,
  );
  assert.match(
    first.text,
    new RegExp(`^${WAKE_PREFIX} decision ${decisionId} answered\\.`),
  );

  await waitFor(
    () => readJsonl(statusLog).length >= 4,
    MINUTE,
    "the orchestrator back at its prompt after list_events",
  );
  note("orchestrator read the events and waits");

  await finishGroup(sb, sample, group);
  await waitFor(
    async () => (await cardOf(sb, BOARD, GROUP_ID))?.column === "agent_done",
    4 * MINUTE,
    "the group card in agent_done",
  );
  note("group reached agent_done");

  const second = await waitFor(
    () => wakeLines(transcript).find((l) => l.text.includes("agent_done")),
    2 * MINUTE,
    "the Agent done wake line",
  );
  note(
    `agent_done wake line ${((second.at - first.at) / 1000).toFixed(1)}s after the first`,
  );
  assert.ok(second.at - first.at >= WAKE_GAP_MS, "one wake line per 20 s");
  assert.match(second.text, new RegExp(`${GROUP_ID} agent_done`));

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
  assert.deepEqual(
    tools.map((l) => l.tool),
    [
      "read_state",
      "get_policy",
      "create_group",
      "start_group",
      "create_decision_item",
      "list_events",
      "start_ship",
      "get_ship_state",
    ],
  );
  for (const line of tools)
    assert.equal(line.expectMet, true, JSON.stringify(line));
  assert.equal(replay.at(-1)?.stopped, undefined);

  assert.deepEqual(mainSubjects(sample, sb.home), [
    MERGED_SUBJECT,
    "chore: initial commit",
  ]);
  assert.equal(
    git(sample.bare, sb.home, ["show", "main:feature.txt"]),
    "woken group work",
    "the bare origin main holds the group file",
  );
  const done = await waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, GROUP_ID);
      return card?.column === "done" ? card : null;
    },
    MINUTE,
    "the group card in Done",
  );
  assert.equal(done.shipFlow?.state, "done");

  const windows = busyWindows(statusLog);
  assert.ok(windows.length >= 3, "the fake showed busy rows in 3 windows");
  assert.ok(
    insideAny(windows, answeredAt),
    "the decision was answered while the orchestrator showed busy rows",
  );
  const rows = await waitFor(
    async () => {
      const found = wakeRows(await sb.orchestrationEvents(BOARD));
      return found.length === wakeLines(transcript).length ? found : null;
    },
    MINUTE,
    "one orchestrator_wake row for each wake line",
  );
  assert.ok(rows.length >= 2);
  for (const row of rows) assert.equal(row.data.result, "confirmed");
  assert.deepEqual(rows[0]?.data.reasons, [`decision ${decisionId} answered`]);
  assert.deepEqual(rows[1]?.data.reasons, [`${GROUP_ID} agent_done`]);
  for (const row of rows) {
    assert.equal(
      insideAny(windows, Date.parse(row.ts)),
      false,
      `wake row ${row.id} at ${row.ts} is inside a busy window`,
    );
  }
  for (const line of wakeLines(transcript)) {
    assert.equal(
      insideAny(windows, line.at),
      false,
      `wake line "${line.text}" arrived inside a busy window`,
    );
  }
}

void test(
  "scenario 5: a decision answer and Agent done each wake the orchestrator, and it ships the group",
  { timeout: 20 * MINUTE },
  async () => {
    const sb = await startSandbox({ name: "s5-wake" });
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

void test("scenario 5 code types no key into any pane", () => {
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
    path.join(import.meta.dirname, "fixtures/scenario-5/orchestrator.ts"),
  ];
  for (const file of files) {
    assert.equal(typing.test(fs.readFileSync(file, "utf8")), false, file);
  }
});
