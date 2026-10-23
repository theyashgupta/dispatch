import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { projectsDirOf } from "../../src/server/adapters/transcript.js";
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

const NAME = "local-99-resume-latest";
const BOARD = "RES";
const CARD = "RES-1";
const RUN_LOG = path.join(EVIDENCE_DIR, "local-99-resume-latest-run-log.txt");
const ARGV_FILE = path.join(SANDBOX_ROOT, NAME, "argv.jsonl");
const OLD_ID = "11111111-1111-4111-8111-111111111111";
const NEW_ID = "22222222-2222-4222-8222-222222222222";

const note = makeNote("local-99-resume-latest");

/**
 * Post one hook event the way a real session does, with the token read from the tmux session environment.
 *
 * @remarks A hook is the only way a fake session reports its transcript file or its end of turn.
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

/** Read the argument lists the fake claude recorded, one per launch. */
const launches = (): string[][] =>
  fs.existsSync(ARGV_FILE)
    ? fs
        .readFileSync(ARGV_FILE, "utf8")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l) as string[])
    : [];

/** Return the session id a launch resumes, "continue" for a bare continue, or "none". */
function resumedIdOf(argv: string[]): string {
  const at = argv.indexOf("--resume");
  if (at >= 0) return argv[at + 1] ?? "none";
  return argv.includes("--continue") ? "continue" : "none";
}

/** Report a session start for `id` by hook and write the one-line transcript file it names. */
async function startSessionRecord(
  sb: Sandbox,
  session: string,
  folder: string,
  id: string,
  source: string,
): Promise<void> {
  const transcript = path.join(folder, `${id}.jsonl`);
  fs.writeFileSync(
    transcript,
    `${JSON.stringify({ type: "user", message: { content: "hello" }, timestamp: new Date().toISOString() })}\n`,
  );
  await postHook(sb, session, {
    hook_event_name: "SessionStart",
    session_id: id,
    source,
    transcript_path: transcript,
  });
}

/**
 * Start a card on a sample repo and wait until it shows a live tmux session and an active session id.
 *
 * @remarks The supervisor is off because it resumes a lost session by itself, which would race the explicit Resume call.
 */
async function startCard(sb: Sandbox): Promise<string> {
  const sample = makeSampleRepo(sb.root, sb.home);
  fs.writeFileSync(
    path.join(sb.scenarios, "default.json"),
    JSON.stringify({ statusRows: readyRows(), reply: "ok" }),
  );
  const sessions = path.join(sb.workspaces, "res-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Resume board",
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
    supervisor: "off",
    groupPlaybook: null,
  });
  assert.equal(policy.status, 200);
  const made = await sb.api<{ id: string }>(
    "POST",
    `/api/cards?board=${BOARD}`,
    {
      title: "Resume me",
      description: "A ticket whose conversation is cleared.",
    },
  );
  assert.equal(made.status, 201);
  assert.equal(made.body.id, CARD);
  const start = await sb.api("POST", `/api/cards/${CARD}/start`, {
    folder: sb.workspaces,
    repos: [{ path: sample.repo, base: "main" }],
  });
  assert.equal(start.status, 202);
  const live = await waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, CARD);
      return card?.tmuxSession !== undefined &&
        card.activeSessionId !== undefined
        ? card
        : null;
    },
    MINUTE,
    "the card with a live tmux session and an active session id",
  );
  note("session started");
  return live.tmuxSession ?? "";
}

/** Clear the conversation, let the old one send a late Stop, kill the tmux server and resume the card. */
async function runScenario(sb: Sandbox): Promise<void> {
  const session = await startCard(sb);
  const card = await cardOf(sb, BOARD, CARD);
  const folder = projectsDirOf(
    path.join(sb.home, ".claude"),
    card?.workspacePath ?? "",
  );
  fs.mkdirSync(folder, { recursive: true });

  await startSessionRecord(sb, session, folder, OLD_ID, "startup");
  await sb.pause(1100);
  await startSessionRecord(sb, session, folder, NEW_ID, "clear");
  await sb.pause(1100);
  await postHook(sb, session, {
    hook_event_name: "Stop",
    session_id: OLD_ID,
    last_assistant_message: "late",
  });
  note("two conversations reported, late Stop of the old one sent");

  spawnSync("tmux", ["-L", sb.tmuxLabel, "kill-server"], { stdio: "ignore" });
  await waitFor(
    async () => {
      const lost = await cardOf(sb, BOARD, CARD);
      return lost?.tmuxSession === undefined || lost.sessionLost === true;
    },
    MINUTE,
    "the card to show the session as lost",
  );
  note("session lost");

  const before = launches().length;
  await waitFor(
    async () =>
      (await sb.api("POST", `/api/cards/${CARD}/resume`)).status === 202,
    MINUTE,
    "Resume to answer 202 once the start saga has ended",
  );
  const argv = await waitFor(
    () => launches().slice(before).at(-1),
    MINUTE,
    "the fake claude launched by Resume",
  );
  const resumedId = resumedIdOf(argv);
  note(`Resume opened ${resumedId}`);
  assert.equal(
    resumedId,
    NEW_ID,
    `Resume opened ${resumedId}, not the newest ${NEW_ID}`,
  );
}

void test(
  "scenario-LOCAL-99-resume-latest: Resume opens the newest conversation after a clear",
  { timeout: 10 * MINUTE },
  async () => {
    process.env.FAKE_CLAUDE_ARGV_FILE = ARGV_FILE;
    const sb = await startSandbox({ name: NAME });
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
      delete process.env.FAKE_CLAUDE_ARGV_FILE;
    }
  },
);
