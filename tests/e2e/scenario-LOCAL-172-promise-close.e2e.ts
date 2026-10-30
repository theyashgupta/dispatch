import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Card, LoopProgress, ShipFlow } from "../../src/shared/types.js";
import {
  git,
  makeSampleRepo,
  type SampleRepo,
} from "./fixtures/scenario-1/repo.js";
import { readyRows } from "./fixtures/scenario-1/status-rows.js";
import { cardOf, writeRunLog } from "./harness/board-reads.js";
import {
  EVIDENCE_DIR,
  MINUTE,
  SANDBOX_ROOT,
  makeNote,
  startSandbox,
  waitFor,
  type OrchestrationEventRow,
  type Sandbox,
} from "./harness/sandbox.js";

const BOARD = "PCL";
const CARD = "PCL-1";
const ORCHESTRATOR_CARD = "PCL-2";
const SLUG = "local-159";
const PROMISE = `<promise>RALPH COMPLETE ${SLUG}</promise>`;
const DONE_LINE = "DISPATCH_STATUS: DONE - LOCAL-159 built";
const CLAUDE_SESSION = "7d1b9c2e-4a3f-4b5c-8d6e-2f3a4b5c6d7e";
const RUN_LOG = path.join(EVIDENCE_DIR, "local-172-promise-close-run-log.txt");
const QA_OUT = process.env.LOCAL172_QA_OUT ?? "";
const CLOSE_LIMIT_SECONDS = 60;
const ENGINE_REL = ".claude/ralph-loop.local.md";
const SHIP_BODY =
  "What\nThe work of the card.\nWhy\nThe card is done.\nHow\nShipped by the test.";

const note = makeNote("local-172-promise-close");

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
}

interface ProgressReply {
  cardId: string;
  loopProgress: LoopProgress | null;
  lastMarker: string | null;
}

interface Evidence {
  refused: Reply;
  doneAt: string;
  close: OrchestrationEventRow;
  seconds: number;
  progress: ProgressReply;
  shipped: Reply;
  flowState: string;
}

/**
 * Post a hook event to the server with the hook token of one tmux session.
 *
 * @remarks The token is read from the tmux session environment, the same place the hook script of a real session reads it.
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

const sendStopHook = (
  sb: Sandbox,
  session: string,
  message: string,
  transcriptPath: string,
): Promise<void> =>
  postHook(sb, session, {
    hook_event_name: "Stop",
    session_id: CLAUDE_SESSION,
    last_assistant_message: message,
    transcript_path: transcriptPath,
  });

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

const readProgress = async (
  sb: Sandbox,
  token: string,
): Promise<ProgressReply> =>
  (await orch<ProgressReply>(sb, token, "GET", `/cards/${CARD}/progress`)).body;

async function setup(sb: Sandbox): Promise<SampleRepo> {
  const sample = makeSampleRepo(sb.root, sb.home);
  const sessions = path.join(sb.workspaces, "pcl-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Promise close board",
    workspaceRoot: sessions,
    repositories: [
      { path: sample.repo, baseBranch: "main", checkCommand: "true" },
    ],
  });
  assert.equal(board.status, 201);
  const policy = await sb.api("PUT", `/api/boards/${BOARD}/policy`, {
    roadmapApproval: "all",
    concurrencyCap: 3,
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
  const made = await sb.api<{ id: string }>(
    "POST",
    `/api/cards?board=${BOARD}`,
    {
      title: "Build the LOCAL-159 feature",
      description: "One feature of one module.",
    },
  );
  assert.equal(made.status, 201);
  assert.equal(made.body.id, CARD);
  const added = await sb.api("POST", `/api/boards/${BOARD}/orchestrators`, {
    id: "main",
    name: "Main",
    role: "main",
  });
  assert.equal(added.status, 201);
  return sample;
}

/** Writes replay files whose loop pane shows no promise line, so only the Stop hook message can trigger the close. */
function writeScenarios(sb: Sandbox): string {
  const transcript = path.join(sb.logs, "orchestrator.jsonl");
  fs.writeFileSync(transcript, "");
  fs.writeFileSync(
    path.join(sb.scenarios, `${CARD}.json`),
    JSON.stringify({ statusRows: readyRows(), reply: "ok" }),
  );
  fs.writeFileSync(
    path.join(sb.scenarios, `${ORCHESTRATOR_CARD}.json`),
    JSON.stringify({
      statusRows: readyRows(),
      reply: "ok",
      transcriptPath: transcript,
    }),
  );
  return transcript;
}

async function startOrchestrator(
  sb: Sandbox,
  transcript: string,
): Promise<string> {
  const start = await sb.api(
    "POST",
    `/api/boards/${BOARD}/orchestrators/main/start`,
  );
  assert.equal(start.status, 202);
  const session = await waitFor(
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
  await postHook(sb, session, {
    hook_event_name: "SessionStart",
    session_id: "orchestrator",
    transcript_path: transcript,
  });
  const minted = await sb.api<{ token: string }>(
    "POST",
    `/api/boards/${BOARD}/orchestrators/main/token`,
  );
  assert.equal(minted.status, 201);
  note("orchestrator started");
  return minted.body.token;
}

async function startCard(sb: Sandbox, token: string): Promise<Card> {
  const started = await orch(sb, token, "POST", `/cards/${CARD}/start`, {
    playbook: "PRD + Ralph Loop",
    direction: "Build it.",
    account: "default",
  });
  assert.equal(started.status, 202);
  const card = await waitFor(
    async () => {
      const read = await cardOf(sb, BOARD, CARD);
      return read?.tmuxSession !== undefined ? read : null;
    },
    4 * MINUTE,
    `the session of ${CARD}`,
  );
  note(`${CARD} started`);
  return card;
}

function commitWork(sb: Sandbox, sample: SampleRepo, card: Card): void {
  const worktree = path.join(card.workspacePath ?? "", sample.name);
  assert.equal(
    git(worktree, sb.home, ["rev-parse", "--abbrev-ref", "HEAD"]),
    card.identifier,
  );
  fs.writeFileSync(path.join(worktree, "feature.txt"), "feature.txt\n");
  git(worktree, sb.home, ["add", "feature.txt"]);
  git(worktree, sb.home, ["commit", "-q", "-m", "feat: local-159"]);
}

function seedOpenEngine(card: Card, repo: string): void {
  const file = path.join(card.workspacePath ?? "", ENGINE_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [
      "---",
      "active: true",
      "iteration: 1",
      `session_id: ${CLAUDE_SESSION}`,
      "max_iterations: 45",
      `completion_promise: "RALPH COMPLETE ${SLUG}"`,
      `started_at: "${new Date().toISOString()}"`,
      "---",
      "",
      `Execute LOCAL-159 per the ralph-loop skill in the repo ${repo}. Unit A: PRD .planning/prds/local-159-unit-a.md, state .planning/local-159-unit-a/state.md. When and only when both units have gate=pass for every phase, output the phrase RALPH COMPLETE ${SLUG} wrapped in promise tags.`,
      "",
    ].join("\n"),
  );
}

const shipBody = (sample: SampleRepo) => ({
  repository: sample.repo,
  branches: [{ name: CARD, title: `feat: ${SLUG} ${CARD}`, body: SHIP_BODY }],
});

async function assertRefusedWhileOpen(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
): Promise<Reply> {
  const open = await waitFor(
    async () => {
      const progress = (await readProgress(sb, token)).loopProgress;
      return progress?.engine?.active === true && !progress.engine.closed
        ? progress
        : null;
    },
    4 * MINUTE,
    "the card progress to show the open engine",
  );
  assert.equal(open.slug, SLUG);
  const refused = await orch<{ error: string }>(
    sb,
    token,
    "POST",
    `/groups/${CARD}/ship`,
    shipBody(sample),
  );
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "engine-not-closed");
  note("start_ship refused with engine-not-closed before the promise");
  return refused;
}

function writeTranscript(
  sb: Sandbox,
  card: Card,
): { file: string; message: string } {
  const dashed = (card.workspacePath ?? "").replace(/[^a-zA-Z0-9]/g, "-");
  const dir = path.join(sb.home, ".claude", "projects", dashed);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${CLAUDE_SESSION}.jsonl`);
  const message = `Both units are green.\n${PROMISE}\n${DONE_LINE}`;
  const at = new Date().toISOString();
  const entries = [
    {
      type: "user",
      message: { role: "user", content: "Execute LOCAL-159." },
      timestamp: at,
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: message }],
      },
      timestamp: at,
    },
  ];
  fs.writeFileSync(
    file,
    `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
  return { file, message };
}

const closeRows = (events: OrchestrationEventRow[]): OrchestrationEventRow[] =>
  events.filter(
    (e) =>
      e.kind === "supervisor_action" &&
      e.cardId === CARD &&
      e.data.action === "close_loop",
  );

/**
 * Post the DONE Stop hook with a transcript and check that the hook route closes the engine with the reason done_marker, with no restart, within 60 s.
 *
 * @remarks The card holds no PRD and no state file, so no phase can read complete. The Stop message carries the promise line and the DONE line, which a loop with no phase model needs for the close.
 */
async function assertPromiseCloses(
  sb: Sandbox,
  token: string,
  card: Card,
): Promise<{
  doneAt: string;
  close: OrchestrationEventRow;
  seconds: number;
  progress: ProgressReply;
}> {
  const { file, message } = writeTranscript(sb, card);
  const doneAt = new Date().toISOString();
  await sendStopHook(sb, card.tmuxSession ?? "", message, file);
  note(`Stop hook posted at ${doneAt}`);

  const close = await waitFor(
    async () => closeRows(await sb.orchestrationEvents(BOARD))[0],
    CLOSE_LIMIT_SECONDS * 1000,
    "the close_loop supervisor action",
    { pollMs: 500 },
  );
  const seconds = (Date.parse(close.ts) - Date.parse(doneAt)) / 1000;
  note(`close_loop row ${close.id} came ${seconds} s after the Stop hook`);
  assert.equal(close.data.result, "closed");
  assert.equal(close.data.reason, "done_marker");
  assert.ok(seconds <= CLOSE_LIMIT_SECONDS, `${seconds} s is over the limit`);

  const progress = await waitFor(
    async () => {
      const read = await readProgress(sb, token);
      return read.loopProgress?.engine?.closed === true &&
        read.loopProgress.completion === "complete"
        ? read
        : null;
    },
    30_000,
    "the card progress to show the closed engine and completion complete",
  );
  const loop = progress.loopProgress;
  assert.equal(loop?.engine?.closedReason, "done_marker");
  assert.equal(loop?.summary.unitsDone, 1);
  assert.equal(loop?.summary.unitsTotal, 1);
  assert.ok(
    progress.lastMarker?.startsWith("DONE "),
    `lastMarker is ${String(progress.lastMarker)}`,
  );

  const root = card.workspacePath ?? "";
  assert.equal(fs.existsSync(path.join(root, ENGINE_REL)), false);
  const done = path.join(root, `${ENGINE_REL}.done`);
  assert.equal(fs.existsSync(done), true);
  assert.match(fs.readFileSync(done, "utf8"), /^closed_reason: done_marker$/m);

  const events = await sb.orchestrationEvents(BOARD);
  assert.equal(closeRows(events).length, 1, "exactly one close_loop row");
  const restarts = events.filter(
    (e) =>
      e.kind === "supervisor_action" &&
      e.cardId === CARD &&
      Date.parse(e.ts) >= Date.parse(doneAt) &&
      (e.data.action === "resume" ||
        (e.data.action === "continue" && e.data.duty === "restart")),
  );
  assert.deepEqual(restarts, [], "the supervisor did not restart the loop");
  return { doneAt, close, seconds, progress };
}

async function startShip(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
): Promise<{ shipped: Reply; flowState: string }> {
  await waitFor(
    async () => (await cardOf(sb, BOARD, CARD))?.column === "agent_done",
    MINUTE,
    `${CARD} in agent_done`,
  );
  const shipped = await orch<{ error?: string }>(
    sb,
    token,
    "POST",
    `/groups/${CARD}/ship`,
    shipBody(sample),
  );
  assert.equal(shipped.status, 202, JSON.stringify(shipped.body));
  note(`start_ship accepted with ${shipped.status}`);
  const flow = await waitFor(
    async () => {
      const read = await orch<{ flow: ShipFlow }>(
        sb,
        token,
        "GET",
        `/groups/${CARD}/ship`,
      );
      return read.body.flow !== undefined && read.body.flow.state !== "running"
        ? read.body.flow
        : null;
    },
    5 * MINUTE,
    `the ship flow of ${CARD} to leave the running state`,
    { pollMs: 1000 },
  );
  return { shipped, flowState: flow.state };
}

function writeQaFile(sb: Sandbox, e: Evidence): void {
  if (QA_OUT === "") return;
  const text = [
    "# LOCAL-172 sandbox run: engine close on the promise",
    "",
    `- Sandbox port: ${sb.port}`,
    `- Stop hook time: ${e.doneAt}`,
    `- close_loop event id: ${e.close.id}`,
    `- close_loop event ts: ${e.close.ts}`,
    `- close_loop event data: ${JSON.stringify(e.close.data)}`,
    `- Seconds from the Stop hook to the close: ${e.seconds}`,
    `- start_ship reply before the promise: ${e.refused.status} ${JSON.stringify(e.refused.body)}`,
    `- Engine after the close: ${JSON.stringify(e.progress.loopProgress?.engine)}`,
    `- Completion after the close: ${e.progress.loopProgress?.completion}`,
    `- Summary after the close: ${JSON.stringify(e.progress.loopProgress?.summary)}`,
    `- lastMarker after the close: ${e.progress.lastMarker}`,
    `- start_ship reply after the close: ${e.shipped.status} ${JSON.stringify(e.shipped.body)}`,
    `- Ship flow state when the test ended: ${e.flowState}`,
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(QA_OUT), { recursive: true });
  fs.writeFileSync(QA_OUT, text);
}

/**
 * Run a LOCAL-159 shaped PRD loop card from its open engine to an accepted start_ship with the engine closed by the supervisor alone.
 *
 * @remarks The only inputs after the orchestrator start are orchestrator routes called with its token, the Stop hook of the session, a
 * transcript file, and git and file writes in the session folder. The test never renames the engine file.
 */
async function runScenario(sb: Sandbox): Promise<void> {
  const sample = await setup(sb);
  const transcript = writeScenarios(sb);
  const token = await startOrchestrator(sb, transcript);
  const card = await startCard(sb, token);
  commitWork(sb, sample, card);
  seedOpenEngine(card, sample.repo);
  const refused = await assertRefusedWhileOpen(sb, sample, token);
  const closed = await assertPromiseCloses(sb, token, card);
  const { shipped, flowState } = await startShip(sb, sample, token);
  writeQaFile(sb, { refused, shipped, flowState, ...closed });
}

void test(
  "scenario-LOCAL-172-promise-close: the DONE Stop hook with the promise line closes the engine of a single PRD loop with no phases, and start_ship is then accepted",
  { timeout: 20 * MINUTE },
  async () => {
    const sample = path.join(
      SANDBOX_ROOT,
      "local-172-promise-close-memory-sample.json",
    );
    fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
    fs.writeFileSync(
      sample,
      JSON.stringify({
        freeMb: 4096,
        compressorMb: 500,
        swapUsedMb: 0,
        swapTotalMb: 12288,
        load1: 2,
      }),
    );
    const sb = await startSandbox({
      name: "local-172-promise-close",
      memorySampleFile: sample,
    });
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

void test("scenario-LOCAL-172-promise-close code types no key into any pane", () => {
  const typing = new RegExp(
    [
      ["send", "keys"].join("-?"),
      ["send", "Literal"].join(""),
      ["paste", "buffer"].join("-"),
      ["load", "buffer"].join("-"),
    ].join("|"),
    "i",
  );
  assert.equal(
    typing.test(fs.readFileSync(import.meta.filename, "utf8")),
    false,
  );
});
