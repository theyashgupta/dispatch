import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Card } from "../../src/shared/types.js";
import { makeSampleRepo } from "./fixtures/scenario-1/repo.js";
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

const NAME = "local-201-session-release";
const BOARD = "REL";
const CARD = "REL-1";
const ORCHESTRATOR_CARD = "REL-2";
const SLUG = "local-201";
const PROMISE = `<promise>RALPH COMPLETE ${SLUG}</promise>`;
const DONE_LINE = "DISPATCH_STATUS: DONE - LOCAL-201 built";
const CLAUDE_SESSION = "9e2c4b1a-6d3f-4a5b-8c7d-1f2a3b4c5d6e";
const RELEASE_MS = 20_000;
const SAMPLE_FILE = path.join(SANDBOX_ROOT, `${NAME}-memory-sample.json`);
const RUN_LOG = path.join(EVIDENCE_DIR, `${NAME}-run-log.txt`);
const ENGINE_REL = ".claude/ralph-loop.local.md";

const note = makeNote(NAME);

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
}

/** Write a memory sample with low swap, so the memory governor never refuses a start. */
function writeLowSwap(): void {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  fs.writeFileSync(
    SAMPLE_FILE,
    JSON.stringify({
      freeMb: 4096,
      compressorMb: 500,
      swapUsedMb: 0,
      swapTotalMb: 12288,
      load1: 2,
    }),
  );
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

async function setup(sb: Sandbox): Promise<string> {
  const sample = makeSampleRepo(sb.root, sb.home);
  const sessions = path.join(sb.workspaces, "rel-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Session release board",
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
      title: "Build the LOCAL-201 feature",
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
  return sample.repo;
}

/** Writes the replay files, with a loop card whose fake Claude ends on `/exit`. */
function writeScenarios(sb: Sandbox): { transcript: string; card: string } {
  const transcript = path.join(sb.logs, "orchestrator.jsonl");
  fs.writeFileSync(transcript, "");
  const card = path.join(sb.scenarios, `${CARD}.json`);
  fs.writeFileSync(
    card,
    JSON.stringify({ statusRows: readyRows(), reply: "ok", exitOnExit: true }),
  );
  fs.writeFileSync(
    path.join(sb.scenarios, `${ORCHESTRATOR_CARD}.json`),
    JSON.stringify({
      statusRows: readyRows(),
      reply: "ok",
      transcriptPath: transcript,
    }),
  );
  return { transcript, card };
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
  note(`${CARD} started in ${card.tmuxSession}`);
  return card;
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
      `Execute LOCAL-201 per the ralph-loop skill in the repo ${repo}. When and only when the work is complete, output the phrase RALPH COMPLETE ${SLUG} wrapped in promise tags.`,
      "",
    ].join("\n"),
  );
}

function writeTranscript(
  sb: Sandbox,
  card: Card,
): { file: string; message: string } {
  const dashed = (card.workspacePath ?? "").replace(/[^a-zA-Z0-9]/g, "-");
  const dir = path.join(sb.home, ".claude", "projects", dashed);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${CLAUDE_SESSION}.jsonl`);
  const message = `The work is complete.\n${PROMISE}\n${DONE_LINE}`;
  const at = new Date().toISOString();
  const entries = [
    {
      type: "user",
      message: { role: "user", content: "Execute LOCAL-201." },
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

const supervisorActions = async (
  sb: Sandbox,
  action: string,
): Promise<OrchestrationEventRow[]> =>
  (await sb.orchestrationEvents(BOARD)).filter(
    (e) =>
      e.kind === "supervisor_action" &&
      e.cardId === CARD &&
      e.data.action === action,
  );

/**
 * List the pids of the pty shim on the pane tty and of its child, the fake claude.
 *
 * @remarks Claude runs behind `pty-shim.py` on its own pty, so the pane foreground command reads `Python`, not `node`. The shim and its child end together when Claude exits, and the login shell stays.
 */
function claudePids(sb: Sandbox, session: string): number[] {
  const tty = sb
    .tmux(["display-message", "-p", "-t", `=${session}:`, "#{pane_tty}"])
    .trim()
    .replace(/^\/dev\//, "");
  assert.notEqual(tty, "", "the pane has a tty");
  const onTty = execFileSync("ps", ["-t", tty, "-o", "pid=,command="], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((l) => l.includes("pty-shim.py"))
    .map((l) => Number(l.trim().split(/\s+/)[0]));
  const table = execFileSync("ps", ["-ax", "-o", "pid=,ppid="], {
    encoding: "utf8",
  })
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number));
  const children = table
    .filter(([, ppid]) => onTty.includes(ppid ?? -1))
    .map(([pid]) => pid ?? -1);
  return [...onTty, ...children];
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function runningLoops(sb: Sandbox): Promise<number> {
  const res = await sb.api<{ runningLoops: number }>(
    "GET",
    `/api/boards/${BOARD}/orchestration`,
  );
  assert.equal(res.status, 200);
  return res.body.runningLoops;
}

/**
 * Send the DONE Stop hook of the loop card and return the later of its two clocks once the card is in Agent done.
 *
 * @remarks The DONE line is also written into the replay file, so the pane of the fake shows it and the capture after the release can find it.
 */
async function finishCard(
  sb: Sandbox,
  card: Card,
  scenarioFile: string,
): Promise<{ since: number; pids: number[] }> {
  const session = card.tmuxSession ?? "";
  const pids = await waitFor(
    () => {
      const found = claudePids(sb, session);
      return Promise.resolve(found.length >= 2 ? found : null);
    },
    MINUTE,
    "the pty shim and the fake claude on the pane tty",
  );
  note(`claude pids before the release: ${pids.join(", ")}`);
  const { file, message } = writeTranscript(sb, card);
  fs.writeFileSync(
    scenarioFile,
    JSON.stringify({
      statusRows: readyRows(),
      transcript: [DONE_LINE],
      reply: "ok",
      exitOnExit: true,
    }),
  );
  await postHook(sb, session, {
    hook_event_name: "Stop",
    session_id: CLAUDE_SESSION,
    last_assistant_message: message,
    transcript_path: file,
  });
  note(`Stop hook posted at ${new Date().toISOString()}`);
  const done = await waitFor(
    async () => {
      const read = await cardOf(sb, BOARD, CARD);
      return read?.column === "agent_done" &&
        read.lastMarker?.startsWith("DONE ")
        ? read
        : null;
    },
    2 * MINUTE,
    `${CARD} in agent_done with a DONE marker`,
  );
  const stamps = [done.columnSince, done.stateSince]
    .map((t) => Date.parse(t ?? ""))
    .filter(Number.isFinite);
  assert.ok(stamps.length > 0, "the card carries a clock stamp");
  note(
    `${CARD} in agent_done: columnSince ${done.columnSince}, stateSince ${done.stateSince}, state ${done.state}`,
  );
  return { since: Math.max(...stamps), pids };
}

/**
 * Check the release of a finished loop card: the row, the state, the exited process, the kept pane, the running count and the quiet minute after.
 *
 * @remarks The process check lists the processes on the pane tty with `ps`. The fake claude script is in the list while it runs and gone after `/exit`, and the login shell stays.
 */
async function assertReleased(
  sb: Sandbox,
  session: string,
  since: number,
  pids: number[],
): Promise<void> {
  const row = await waitFor(
    async () =>
      (await supervisorActions(sb, "release_session")).find(
        (e) => e.data.result === "released",
      ) ?? null,
    3 * MINUTE,
    "the release_session row with result released",
    { pollMs: 500 },
  );
  const waited = Date.parse(row.ts) - since;
  note(`release_session row ${row.id} came ${waited / 1000} s after the clock`);
  assert.ok(
    waited >= RELEASE_MS,
    `release came ${waited} ms after the clock, expected at least ${RELEASE_MS}`,
  );
  const idle = (await sb.orchestrationEvents(BOARD))
    .filter(
      (e) =>
        e.kind === "supervisor_state" &&
        e.cardId === CARD &&
        e.data.to === "idle" &&
        e.id < row.id,
    )
    .at(-1);
  assert.ok(idle, "a supervisor_state row to idle comes before the release");
  const idleFor = Date.parse(row.ts) - Date.parse(idle.ts);
  note(`idle row ${idle.id}, release ${idleFor / 1000} s after it`);
  assert.ok(
    idleFor >= RELEASE_MS,
    `release came ${idleFor} ms after the idle row, expected at least ${RELEASE_MS}`,
  );

  const card = await cardOf(sb, BOARD, CARD);
  assert.equal(card?.state, "released");
  assert.equal(card?.column, "agent_done");
  assert.ok(card?.lastMarker?.startsWith("DONE "));
  assert.deepEqual(
    pids.filter(alive),
    [],
    "the pty shim and the fake claude are gone",
  );
  assert.deepEqual(claudePids(sb, session), []);
  note(`claude pids ${pids.join(", ")} are gone, the pane runs the shell`);

  sb.tmux(["has-session", "-t", `=${session}`]);
  const pane = sb.tmux(["capture-pane", "-p", "-t", `=${session}:`, "-S", "-"]);
  assert.ok(pane.includes(DONE_LINE), "the pane still holds the DONE line");
  note("tmux session live, pane holds the DONE line");
  assert.equal(await runningLoops(sb), 0);

  await sb.pause(60_000);
  const releases = await supervisorActions(sb, "release_session");
  assert.equal(releases.filter((e) => e.data.result === "released").length, 1);
  const resumes = (await supervisorActions(sb, "resume")).filter(
    (e) => e.id > row.id,
  );
  assert.deepEqual(resumes, [], "no resume row after the release");
  assert.equal((await cardOf(sb, BOARD, CARD))?.state, "released");
  assert.deepEqual(claudePids(sb, session), []);
  note("still released after 60 s, no resume row");
}

/**
 * Run one launched loop card from an open engine to a released session.
 *
 * @remarks The only inputs after the orchestrator start are the start_card route, the Stop hook, a transcript file and the engine file.
 */
async function runScenario(sb: Sandbox): Promise<void> {
  const repo = await setup(sb);
  const files = writeScenarios(sb);
  const token = await startOrchestrator(sb, files.transcript);
  const card = await startCard(sb, token);
  seedOpenEngine(card, repo);
  const { since, pids } = await finishCard(sb, card, files.card);
  await assertReleased(sb, card.tmuxSession ?? "", since, pids);
}

void test(
  "scenario-LOCAL-201-session-release: a finished launched card gets /exit after the idle period, keeps its pane and column, and is never resumed",
  { timeout: 10 * MINUTE },
  async () => {
    writeLowSwap();
    const sb = await startSandbox({
      name: NAME,
      memorySampleFile: SAMPLE_FILE,
      env: { DISPATCH_RELEASE_AFTER_MS: String(RELEASE_MS) },
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
