import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ORCHESTRATOR_TOKEN_HEADER } from "../../src/shared/orchestrator-limits.js";
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
  type Sandbox,
} from "./harness/sandbox.js";

const NAME = "scenario-21";
const BOARD = "PRS";
const ORCHESTRATOR = "main";
const CARD = "PRS-1";
const CONVERSATION = "conv-pause-resume";
const RUN_LOG = path.join(EVIDENCE_DIR, "scenario-21-run-log.txt");
const SAMPLE_FILE = path.join(SANDBOX_ROOT, `${NAME}-memory-sample.json`);
const LINE = "Delegate: are you there after the resume?";
const TMUX_MISSING =
  spawnSync("tmux", ["-V"], { stdio: "ignore" }).status !== 0
    ? "tmux is not installed"
    : false;

const note = makeNote("scenario-21");

/** Write a memory sample with low swap, so the governor never pauses or refuses anything. */
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

/** Return the `ps` state letters of `pid`, or an empty string when the process is gone. */
function stateOf(pid: number): string {
  return spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
    encoding: "utf8",
  }).stdout.trim();
}

/** Return the first child pid of `pid`, or undefined when it has none. */
function childOf(pid: number): number | undefined {
  const out = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
  const first = out.stdout.split("\n").find((l) => l.trim() !== "");
  return first === undefined ? undefined : Number(first);
}

/** Call one orchestrator route with the orchestrator token. */
async function orchestrator(
  sb: Sandbox,
  token: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await fetch(`${sb.url}/api/orchestrator${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [ORCHESTRATOR_TOKEN_HEADER]: token,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, text: await res.text() };
}

/** Post one hook event for a session with the hook token of its tmux environment. */
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

/**
 * Start one loop through the orchestrator, pause it with `pause_card`, resume it with `resume_card`, then send one line.
 *
 * @remarks The fake inserts a line feed into its prompt box, so a pane tty left cooked by the shell would hold the line and the send would answer unconfirmed.
 */
async function runScenario(sb: Sandbox): Promise<void> {
  const transcript = path.join(
    sb.root,
    "projects",
    "prs",
    `${CONVERSATION}.jsonl`,
  );
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(transcript, "");
  fs.writeFileSync(
    path.join(sb.scenarios, "default.json"),
    JSON.stringify({
      statusRows: readyRows(),
      reply: "ok",
      transcriptPath: transcript,
      lfInserts: true,
    }),
  );
  const sample = makeSampleRepo(sb.root, sb.home);
  const sessions = path.join(sb.workspaces, "prs-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Pause and resume board",
    workspaceRoot: sessions,
    repositories: [
      { path: sample.repo, baseBranch: "main", checkCommand: "true" },
    ],
  });
  assert.equal(board.status, 201);
  const added = await sb.api("POST", `/api/boards/${BOARD}/orchestrators`, {
    id: ORCHESTRATOR,
    name: "Main",
    role: "main",
  });
  assert.equal(added.status, 201);
  const minted = await sb.api<{ token: string }>(
    "POST",
    `/api/boards/${BOARD}/orchestrators/${ORCHESTRATOR}/token`,
  );
  const token = minted.body.token;
  const made = await sb.api<{ id: string }>(
    "POST",
    `/api/cards?board=${BOARD}`,
    { title: "Pause me", description: "A loop that is paused and resumed." },
  );
  assert.equal(made.body.id, CARD);
  const started = await orchestrator(sb, token, `/cards/${CARD}/start`, {
    playbook: "Write code directly",
    repos: [{ path: sample.repo, base: "main" }],
  });
  assert.equal(started.status, 202, started.text);
  const live = await waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, CARD);
      return card?.tmuxSession !== undefined &&
        card.activeSessionId !== undefined
        ? card
        : null;
    },
    MINUTE,
    "the card with a live tmux session",
  );
  const session = live.tmuxSession ?? "";
  note(`session started: ${session}`);
  await postHook(sb, session, {
    hook_event_name: "UserPromptSubmit",
    session_id: CONVERSATION,
    transcript_path: transcript,
    prompt: "hi",
  });
  await waitFor(
    async () =>
      (await cardOf(sb, BOARD, CARD))?.claudeSessionId === CONVERSATION,
    MINUTE,
    `claudeSessionId ${CONVERSATION} on the card`,
  );

  const shellPid = Number(
    sb.tmux(["display-message", "-p", "-t", `=${session}:`, "#{pane_pid}"]),
  );
  const shimPid = childOf(shellPid);
  assert.ok(shimPid !== undefined, "the pane shell runs a job");

  const paused = await orchestrator(sb, token, `/sessions/${CARD}/pause`);
  assert.equal(paused.status, 200, paused.text);
  const mark = (await cardOf(sb, BOARD, CARD))?.paused;
  assert.ok(mark && mark.pids.length > 0, "the card has a pause mark");
  assert.ok(!mark.pids.includes(shellPid), "the pane shell is not stopped");
  assert.ok(!mark.pids.includes(shimPid), "the pty shim is not stopped");
  assert.ok(
    mark.pids.some((pid) => stateOf(pid).startsWith("T")),
    "claude is stopped",
  );
  assert.doesNotMatch(stateOf(shellPid), /^T/);
  assert.doesNotMatch(stateOf(shimPid), /^T/);
  note(`paused, stopped pids ${mark.pids.join(" ")}`);

  const resumed = await orchestrator(sb, token, `/sessions/${CARD}/unpause`);
  assert.equal(resumed.status, 200, resumed.text);
  assert.equal((await cardOf(sb, BOARD, CARD))?.paused ?? null, null);
  for (const pid of mark.pids)
    assert.doesNotMatch(stateOf(pid), /^T/, `pid ${pid} is still stopped`);
  note("resumed through resume_card");

  const sent = await sb.api<{ result: string }>(
    "POST",
    `/api/sessions/${CARD}/input`,
    { text: LINE },
  );
  assert.equal(sent.status, 200);
  assert.equal(sent.body.result, "confirmed", "the line reached the REPL");
  assert.ok(fs.readFileSync(transcript, "utf8").includes(LINE));
  note("the line typed after the resume was echoed into the transcript");
}

void test(
  "scenario 21: pause_card and resume_card keep the REPL usable and a line typed after the resume is echoed",
  { timeout: 6 * MINUTE, skip: TMUX_MISSING },
  async () => {
    writeLowSwap();
    const sb = await startSandbox({
      name: NAME,
      memorySampleFile: SAMPLE_FILE,
    });
    try {
      await runScenario(sb);
    } finally {
      try {
        await writeRunLog(sb, BOARD, RUN_LOG);
      } catch (err) {
        note(
          `run log failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      await sb.stop();
    }
  },
);
