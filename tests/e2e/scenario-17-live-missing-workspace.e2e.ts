import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { makeSampleRepo } from "./fixtures/scenario-1/repo.js";
import { readyRows } from "./fixtures/scenario-1/status-rows.js";
import { cardOf } from "./harness/board-reads.js";
import {
  MINUTE,
  SANDBOX_ROOT,
  makeNote,
  sleep,
  startSandbox,
  waitFor,
  type Sandbox,
} from "./harness/sandbox.js";

const NAME = "scenario-17";
const BOARD = "LWM";
const CARD = "LWM-1";
const ARGV_FILE = path.join(SANDBOX_ROOT, NAME, "argv.jsonl");

const SAMPLE_FILE = path.join(SANDBOX_ROOT, `${NAME}-memory-sample.json`);

const note = makeNote("scenario-17");

const launches = (): number =>
  fs.existsSync(ARGV_FILE)
    ? fs
        .readFileSync(ARGV_FILE, "utf8")
        .split("\n")
        .filter((l) => l !== "").length
    : 0;

/** Answer the board policy body with the supervisor on or off. */
const policy = (supervisor: "on" | "off") => ({
  roadmapApproval: "all",
  concurrencyCap: 2,
  loopModel: "claude-sonnet-5-5:high",
  orchestratorModel: "claude-sonnet-5-5",
  handoffPercent: 50,
  handoffHardPercent: 80,
  usageLimit: "stop",
  shipRights: "merge",
  budgetPerGroup: null,
  supervisor,
  groupPlaybook: null,
});

/** Start one card on a sample repo and answer its workspace path and tmux session once the session is live. */
async function startCard(
  sb: Sandbox,
): Promise<{ workspace: string; session: string }> {
  const sample = makeSampleRepo(sb.root, sb.home);
  fs.writeFileSync(
    path.join(sb.scenarios, "default.json"),
    JSON.stringify({ statusRows: readyRows(), reply: "ok" }),
  );
  const sessions = path.join(sb.workspaces, "lwm-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Live missing workspace board",
    workspaceRoot: sessions,
    repositories: [
      { path: sample.repo, baseBranch: "main", checkCommand: "true" },
    ],
  });
  assert.equal(board.status, 201);
  const off = await sb.api("PUT", `/api/boards/${BOARD}/policy`, policy("off"));
  assert.equal(off.status, 200);
  const made = await sb.api<{ id: string }>(
    "POST",
    `/api/cards?board=${BOARD}`,
    {
      title: "Lose my worktree live",
      description: "A live shell whose folder goes.",
    },
  );
  assert.equal(made.status, 201);
  assert.equal(made.body.id, CARD);
  const start = await sb.api("POST", `/api/cards/${CARD}/start`, {
    folder: sb.workspaces,
    repos: [{ path: sample.repo, base: "main" }],
  });
  assert.equal(start.status, 202, JSON.stringify(start.body));
  const live = await waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, CARD);
      return card?.tmuxSession !== undefined && card.workspacePath
        ? card
        : null;
    },
    MINUTE,
    "the card with a live tmux session",
  );
  note("session started");
  return {
    workspace: live.workspacePath ?? "",
    session: live.tmuxSession ?? "",
  };
}

/**
 * Move the workspace folder away under a live session, drop claude to the shell prompt and turn the supervisor on.
 *
 * @remarks The folder is renamed, not deleted, so the stored path is missing without a delete. `send-keys` is
 * not in the read-only helper of the sandbox, so the key goes through `tmux` on the sandbox label directly.
 */
async function runScenario(sb: Sandbox): Promise<void> {
  const { workspace, session } = await startCard(sb);
  await waitFor(
    () => sb.tmux(["capture-pane", "-p", "-t", `=${session}:`]).includes("❯"),
    MINUTE,
    "the fake claude prompt in the pane",
  );
  fs.renameSync(workspace, `${workspace}-gone`);
  assert.equal(fs.existsSync(workspace), false);
  note("workspace folder moved away");

  const before = launches();
  spawnSync(
    "tmux",
    ["-L", sb.tmuxLabel, "send-keys", "-t", `=${session}:`, "C-c"],
    { stdio: "ignore" },
  );
  const on = await sb.api("PUT", `/api/boards/${BOARD}/policy`, policy("on"));
  assert.equal(on.status, 200);

  const card = await waitFor(
    async () => {
      const c = await cardOf(sb, BOARD, CARD);
      return c?.column === "needs_input" && c.stateReason === "resume_failed"
        ? c
        : null;
    },
    2 * MINUTE,
    "the live resume refusal on the card",
  );
  note(`card shows: ${card.statusReason}`);
  assert.equal(
    card.statusReason,
    `resume: Resume failed: workspace-missing: ${workspace}`,
  );
  assert.equal(card.state, "needs_input");
  assert.notEqual(card.sessionLost, true);
  assert.ok(card.tmuxSession, "the tmux session is still set");
  assert.doesNotThrow(() =>
    sb.tmux(["has-session", "-t", `=${card.tmuxSession}`]),
  );
  assert.notEqual(
    sb.tmux(["list-sessions"]).trim(),
    "",
    "the tmux session is live",
  );
  assert.equal(launches(), before, "no claude launched");
  await sleep(10_000);
  assert.equal(launches(), before, "the supervisor did not retry");
}

void test(
  "scenario 17: the supervisor does not relaunch claude in a live shell whose workspace folder is missing",
  { timeout: 10 * MINUTE },
  async () => {
    process.env.FAKE_CLAUDE_ARGV_FILE = ARGV_FILE;
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
    const sb = await startSandbox({
      name: NAME,
      memorySampleFile: SAMPLE_FILE,
    });
    try {
      await runScenario(sb);
    } finally {
      const workspace = (await cardOf(sb, BOARD, CARD).catch(() => undefined))
        ?.workspacePath;
      if (workspace && fs.existsSync(`${workspace}-gone`)) {
        fs.renameSync(`${workspace}-gone`, workspace);
      }
      await sb.stop();
      delete process.env.FAKE_CLAUDE_ARGV_FILE;
    }
  },
);
