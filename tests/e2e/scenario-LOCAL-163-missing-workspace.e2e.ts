import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { ActivityEvent } from "../../src/shared/types.js";
import { makeSampleRepo } from "./fixtures/scenario-1/repo.js";
import { readyRows } from "./fixtures/scenario-1/status-rows.js";
import { cardOf } from "./harness/board-reads.js";
import {
  MINUTE,
  SANDBOX_ROOT,
  makeNote,
  startSandbox,
  waitFor,
  type Sandbox,
} from "./harness/sandbox.js";

const NAME = "local-163-missing-workspace";
const BOARD = "WSM";
const CARD = "WSM-1";
const ARGV_FILE = path.join(SANDBOX_ROOT, NAME, "argv.jsonl");

const note = makeNote("local-163-missing-workspace");

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

/** Start one card on a sample repo and answer its workspace path once its tmux session is live. */
async function startCard(sb: Sandbox): Promise<string> {
  const sample = makeSampleRepo(sb.root, sb.home);
  fs.writeFileSync(
    path.join(sb.scenarios, "default.json"),
    JSON.stringify({ statusRows: readyRows(), reply: "ok" }),
  );
  const sessions = path.join(sb.workspaces, "wsm-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Missing workspace board",
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
    { title: "Lose my worktree", description: "A session whose folder goes." },
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
      return card?.tmuxSession !== undefined && card.workspacePath
        ? card
        : null;
    },
    MINUTE,
    "the card with a live tmux session",
  );
  note("session started");
  return live.workspacePath ?? "";
}

/**
 * Start a session, stop the server and its tmux, move the workspace folder away and boot again.
 *
 * @remarks The folder is renamed, not deleted, so the stored path is missing without a delete. The
 * sandbox puts `HOME` and the fake `claude` under its own root, so a leak cannot reach a real conversation.
 */
async function runScenario(sandboxes: Sandbox[]): Promise<void> {
  const first = sandboxes[0];
  const workspace = await startCard(first);
  const on = await first.api(
    "PUT",
    `/api/boards/${BOARD}/policy`,
    policy("on"),
  );
  assert.equal(on.status, 200);
  await first.stopServer();
  spawnSync("tmux", ["-L", first.tmuxLabel, "kill-server"], {
    stdio: "ignore",
  });
  fs.renameSync(workspace, `${workspace}-gone`);
  assert.equal(fs.existsSync(workspace), false);
  note("server stopped, tmux killed, workspace folder moved away");

  const before = launches();
  const sb = await startSandbox({ name: NAME, reuseDir: true });
  sandboxes.push(sb);
  const card = await waitFor(
    async () => {
      const c = await cardOf(sb, BOARD, CARD);
      return c?.resumeError && c.column === "needs_input" ? c : null;
    },
    MINUTE,
    "the boot resume refusal on the card",
  );
  note(`card shows: ${card.resumeError}`);
  assert.equal(
    card.resumeError,
    `Resume failed: workspace-missing: ${workspace}`,
  );
  assert.equal(card.sessionLost, true);
  assert.equal(card.state, "needs_input");
  assert.equal(card.stateReason, "resume_failed");
  assert.equal(launches(), before, "no claude launched at boot");
  assert.equal(sb.tmux(["list-sessions"]).trim(), "", "no tmux session");
  const events = await sb.api<{ events: ActivityEvent[] }>(
    "GET",
    `/api/events?board=${BOARD}&cardId=${card.id}&limit=1000`,
  );
  assert.equal(
    events.body.events.filter((e) => e.type === "resume_failed").length,
    1,
  );
  assert.match(
    fs.readFileSync(sb.serverLog, "utf8"),
    new RegExp(`boot resume ${CARD}: failed: Resume failed: workspace-missing`),
  );
}

void test(
  "scenario-LOCAL-163-missing-workspace: boot resume refuses a lost session whose workspace folder is missing",
  { timeout: 10 * MINUTE },
  async () => {
    process.env.FAKE_CLAUDE_ARGV_FILE = ARGV_FILE;
    const sandboxes = [await startSandbox({ name: NAME })];
    try {
      await runScenario(sandboxes);
    } finally {
      for (const sb of sandboxes) await sb.stop();
      delete process.env.FAKE_CLAUDE_ARGV_FILE;
    }
  },
);
