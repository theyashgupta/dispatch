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
import { passLine, type LoopSpec } from "./fixtures/scenario-1/loop-files.js";
import { readyRows } from "./fixtures/scenario-1/status-rows.js";
import { cardOf, readJsonl, writeRunLog } from "./harness/board-reads.js";
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

const BOARD = "ENC";
const CARD = "ENC-1";
const ORCHESTRATOR_CARD = "ENC-2";
const SLUG = "export";
const PROMISE = `<promise>RALPH COMPLETE ${SLUG}</promise>`;
const DONE_LINE = `DISPATCH_STATUS: DONE - ${SLUG} built`;
const CLAUDE_SESSION = "5c0a8b1e-3f2d-4e6a-9b7c-1d2e3f4a5b6c";
const RUN_LOG = path.join(EVIDENCE_DIR, "local-151-engine-close-run-log.txt");
const QA_OUT = process.env.LOCAL151_QA_OUT ?? "";
const CLOSE_LIMIT_SECONDS = 60;
const PRD_REL = "sample-app/.planning/prds/export.md";
const STATE_REL = "sample-app/.planning/export/state.md";
const ENGINE_REL = ".claude/ralph-loop.local.md";
const SHIP_BODY =
  "What\nThe work of the card.\nWhy\nThe card is done.\nHow\nShipped by the test.";

const note = makeNote("local-151-engine-close");

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
}

interface ProgressReply {
  cardId: string;
  loopProgress: LoopProgress | null;
}

interface Evidence {
  refused: Reply;
  doneAt: string;
  close: OrchestrationEventRow;
  seconds: number;
  shipped: Reply;
  pr: number | null;
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
): Promise<LoopProgress | null> =>
  (await orch<ProgressReply>(sb, token, "GET", `/cards/${CARD}/progress`)).body
    .loopProgress;

const phasesPassed = (progress: LoopProgress | null | undefined): boolean => {
  const phases = progress?.units[0]?.phases ?? [];
  return phases.length === 2 && phases.every((p) => p.gate === "pass");
};

async function setup(sb: Sandbox): Promise<SampleRepo> {
  const sample = makeSampleRepo(sb.root, sb.home);
  const sessions = path.join(sb.workspaces, "enc-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Engine close board",
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
      title: "Add the export button",
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

/** Write the replay files: the loop card shows an idle pane with no promise line, and the orchestrator card idles. */
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

/** Start the single PRD + Ralph Loop card through the orchestrator route and return it once its session exists. */
async function startCard(sb: Sandbox, token: string): Promise<Card> {
  const started = await orch(sb, token, "POST", `/cards/${CARD}/start`, {
    playbook: "PRD + Ralph Loop",
    direction: "Build it.",
    account: "default",
  });
  assert.equal(started.status, 202, JSON.stringify(started.body));
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
  git(worktree, sb.home, ["commit", "-q", "-m", "feat: export"]);
}

/** Seed a finished loop at the session root: the PRD, a gate=pass line per phase and an engine file that stays open. */
function seedFinishedLoop(card: Card): void {
  const root = card.workspacePath ?? "";
  const spec: LoopSpec = {
    slug: SLUG,
    title: "Export",
    ticket: CARD,
    branch: CARD,
    repoDir: "sample-app",
    phases: ["Build export", "Add button"],
    clock: () => new Date().toISOString(),
  };
  const write = (rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write(
    PRD_REL,
    [
      "# Export PRD",
      "",
      ...spec.phases.flatMap((name, i) => [
        `### Phase ${i + 1}: ${name}`,
        "- **Retry budget:** 2",
        "",
      ]),
    ].join("\n"),
  );
  const at = new Date().toISOString();
  write(STATE_REL, [1, 2].map((n) => passLine(spec, n, at)).join(""));
  write(
    ENGINE_REL,
    [
      "---",
      "active: true",
      "iteration: 1",
      `session_id: ${CLAUDE_SESSION}`,
      "max_iterations: 50",
      `completion_promise: "RALPH COMPLETE ${SLUG}"`,
      `started_at: "${at}"`,
      "---",
      "",
      `Execute the PRD at ${PRD_REL} per the ralph-loop skill.`,
      "",
    ].join("\n"),
  );
}

const shipBody = (sample: SampleRepo) => ({
  repository: sample.repo,
  branches: [{ name: CARD, title: `feat: export ${CARD}`, body: SHIP_BODY }],
});

/** Wait for the finished loop with its engine still open, and check that start_ship refuses with engine-not-closed. */
async function assertRefusedWhileOpen(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
): Promise<Reply> {
  const open = await waitFor(
    async () => {
      const progress = await readProgress(sb, token);
      return phasesPassed(progress) &&
        progress?.completion === "complete" &&
        progress.engine?.active === true &&
        progress.engine.closed === false
        ? progress
        : null;
    },
    4 * MINUTE,
    "every phase passed, completion complete and the engine open",
  );
  assert.equal(open.engine?.closed, false);
  const refused = await orch<{ error: string }>(
    sb,
    token,
    "POST",
    `/groups/${CARD}/ship`,
    shipBody(sample),
  );
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "engine-not-closed");
  note("start_ship refused with engine-not-closed before the DONE marker");
  return refused;
}

/** Write the transcript of the session with the promise and the DONE line as its last assistant message. */
function writeTranscript(
  sb: Sandbox,
  card: Card,
): { file: string; message: string } {
  const dashed = (card.workspacePath ?? "").replace(/[^a-zA-Z0-9]/g, "-");
  const dir = path.join(sb.home, ".claude", "projects", dashed);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${CLAUDE_SESSION}.jsonl`);
  const message = `All phases are green.\n${PROMISE}\n${DONE_LINE}`;
  const at = new Date().toISOString();
  const entries = [
    {
      type: "user",
      message: { role: "user", content: "Execute the PRD." },
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
 * Post the DONE Stop hook with a transcript and check that the engine closes, with no restart, within 60 s.
 *
 * @remarks The pane never shows the promise line, so the DONE marker of the Stop hook closes the engine of the complete loop.
 */
async function assertSupervisorCloses(
  sb: Sandbox,
  token: string,
  card: Card,
): Promise<{ doneAt: string; close: OrchestrationEventRow; seconds: number }> {
  const pane = sb.tmux([
    "capture-pane",
    "-p",
    "-t",
    `=${card.tmuxSession ?? ""}:`,
  ]);
  assert.equal(
    pane.includes("RALPH COMPLETE"),
    false,
    "the pane has no promise",
  );
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
  note(`close_loop row ${close.id} came ${seconds} s after the DONE marker`);
  assert.equal(close.data.result, "closed");
  assert.ok(seconds <= CLOSE_LIMIT_SECONDS, `${seconds} s is over the limit`);

  const progress = await waitFor(
    async () => {
      const read = await readProgress(sb, token);
      return read?.engine?.closed === true ? read : null;
    },
    30_000,
    "the card progress to show the closed engine",
  );
  assert.ok(
    Date.parse(progress.readAt) >= Date.parse(doneAt),
    `readAt ${progress.readAt} is before the DONE marker ${doneAt}`,
  );
  const root = card.workspacePath ?? "";
  assert.equal(fs.existsSync(path.join(root, ENGINE_REL)), false);
  assert.equal(fs.existsSync(path.join(root, `${ENGINE_REL}.done`)), true);

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
  return { doneAt, close, seconds };
}

/** Start the ship of the closed card and wait for the flow, the merged PR and the file on the bare origin main. */
async function shipAndWait(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
): Promise<{ shipped: Reply; pr: number | null }> {
  await waitFor(
    async () => (await cardOf(sb, BOARD, CARD))?.column === "agent_done",
    MINUTE,
    `${CARD} in agent_done`,
  );
  const shipped = await orch(
    sb,
    token,
    "POST",
    `/groups/${CARD}/ship`,
    shipBody(sample),
  );
  assert.equal(shipped.status, 202, JSON.stringify(shipped.body));
  const flow = await waitFor(
    async () => {
      const read = await orch<{ flow: ShipFlow }>(
        sb,
        token,
        "GET",
        `/groups/${CARD}/ship`,
      );
      if (read.body.flow?.state === "stopped") {
        throw new Error(`the ship of ${CARD} stopped`);
      }
      return read.body.flow?.state === "done" ? read.body.flow : null;
    },
    10 * MINUTE,
    `the ship of ${CARD} to be done`,
    { pollMs: 1000 },
  );
  await waitFor(
    async () => (await cardOf(sb, BOARD, CARD))?.column === "done",
    MINUTE,
    `${CARD} in Done`,
  );
  const calls = readJsonl(sb.gh.log).map((argv) =>
    Array.isArray(argv) ? argv.map(String) : [],
  );
  const verbs = (verb: string) =>
    calls.filter((c) => c[0] === "pr" && c[1] === verb);
  assert.equal(verbs("create").length, 1);
  assert.equal(verbs("merge").length, 1);
  assert.equal(
    git(sample.bare, sb.home, ["show", "main:feature.txt"]),
    "feature.txt",
    "the bare origin main holds feature.txt",
  );
  note(`${CARD} shipped`);
  return { shipped, pr: flow.branches[0]?.pr ?? null };
}

function writeQaFile(sb: Sandbox, e: Evidence): void {
  if (QA_OUT === "") return;
  const text = [
    "# LOCAL-151 sandbox run: engine close after DONE",
    "",
    `- Sandbox port: ${sb.port}`,
    `- DONE marker time (Stop hook): ${e.doneAt}`,
    `- close_loop event id: ${e.close.id}`,
    `- close_loop event ts: ${e.close.ts}`,
    `- Seconds from the DONE marker to the close: ${e.seconds}`,
    `- start_ship reply before the DONE marker: ${e.refused.status} ${JSON.stringify(e.refused.body)}`,
    `- start_ship reply after the close: ${e.shipped.status} ${JSON.stringify(e.shipped.body)}`,
    `- Merged PR number: ${e.pr ?? "unknown"}`,
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(QA_OUT), { recursive: true });
  fs.writeFileSync(QA_OUT, text);
}

/**
 * Run a finished PRD loop card from its start to the merged ship with the engine file closed by Dispatch alone.
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
  seedFinishedLoop(card);
  const refused = await assertRefusedWhileOpen(sb, sample, token);
  const closed = await assertSupervisorCloses(sb, token, card);
  const { shipped, pr } = await shipAndWait(sb, sample, token);
  writeQaFile(sb, { refused, shipped, pr, ...closed });
}

void test(
  "scenario-LOCAL-151-engine-close: the supervisor closes the engine of a finished PRD loop from the transcript tail, and start_ship then merges it",
  { timeout: 20 * MINUTE },
  async () => {
    const sample = path.join(
      SANDBOX_ROOT,
      "local-151-engine-close-memory-sample.json",
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
      name: "local-151-engine-close",
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

void test("scenario-LOCAL-151-engine-close code types no key into any pane", () => {
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
