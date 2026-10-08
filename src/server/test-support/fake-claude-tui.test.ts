import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isolateEnv } from "./fixtures.js";
import { writeFakeClaudeTui } from "./fake-claude-tui.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type { BoardKey, OrchestratorRecord } from "../../shared/types.js";

const env = isolateEnv();
const { run, spawnPiped } = await import("../adapters/exec.js");
const { TMUX_SERVER_ARGS, capturePane, sendKeys, sendLiteral } =
  await import("../adapters/tmux.js");
const { resolveBinaryPath } = await import("../adapters/resolve-binary.js");
const hasTmux = (await resolveBinaryPath("tmux")) !== null;
const { store } = await import("../store/board.store.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { mintOrchestratorToken } =
  await import("../services/orchestration/orchestrator-tokens.js");
const express = (await import("express")).default;
const { answerDecisionItem, createDecisionItem } =
  await import("../services/orchestration/decision-items.js");
const { sessionTools } =
  await import("../services/orchestration/orchestrator-sessions.js");
const { orchestratorRouter } = await import("../routes/orchestrator.route.js");

const REPLAY_BOARD = parseBoardKey("RPL") as BoardKey;
const mainRecord: OrchestratorRecord = {
  id: "main",
  name: "main",
  role: "main",
  scope: { groupIds: [], ticketIds: [] },
  policyOverride: {},
  cardId: null,
  state: "stopped",
  createdAt: "2026-10-07T00:00:00.000Z",
};
setOrchestrationConfig({ linearApiKey: "" });
await store.load();
await store.createBoard({
  key: REPLAY_BOARD,
  name: "Replay",
  workspaceRoot: "/rpl/sessions",
  repositories: [],
  linearTeamKeys: [],
});
await store.setBoardOrchestrators(REPLAY_BOARD, [mainRecord]);
const replayToken = mintOrchestratorToken({
  boardKey: REPLAY_BOARD,
  orchestratorId: "main",
});
const app = express();
app.use("/api/orchestrator", express.json(), orchestratorRouter);
const apiServer = await new Promise<import("node:http").Server>((resolve) => {
  const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
});
const apiPort = (apiServer.address() as { port: number }).port;

after(async () => {
  apiServer.close();
  await run("tmux", [...TMUX_SERVER_ARGS, "kill-server"]).catch(
    () => undefined,
  );
  env.cleanup();
});

async function until(
  done: () => boolean | Promise<boolean>,
  ms = 3000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await done()) && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 50));
}

function readJsonl(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

interface Pane {
  name: string;
  transcript: string;
  keyLog: string;
  screen: () => Promise<string>;
}

async function startPane(
  name: string,
  scenario: Record<string, unknown>,
): Promise<Pane> {
  const dir = fs.mkdtempSync(path.join(env.root, "pane-"));
  const transcript = path.join(dir, "transcript.jsonl");
  const keyLog = path.join(dir, "keys.jsonl");
  const scenarioFile = path.join(dir, "scenario.json");
  fs.writeFileSync(
    scenarioFile,
    JSON.stringify({
      transcriptPath: transcript,
      keyLogPath: keyLog,
      ...scenario,
    }),
  );
  const bin = writeFakeClaudeTui(dir);
  await run("tmux", [
    ...TMUX_SERVER_ARGS,
    "new-session",
    "-d",
    "-s",
    name,
    "-x",
    "80",
    "-y",
    "24",
    `FAKE_CLAUDE_SCENARIO='${scenarioFile}' '${bin}'`,
  ]);
  return { name, transcript, keyLog, screen: () => capturePane(name) };
}

async function stopPane(pane: Pane): Promise<void> {
  await run("tmux", [
    ...TMUX_SERVER_ARGS,
    "kill-session",
    "-t",
    pane.name,
  ]).catch(() => undefined);
}

async function type(pane: Pane, text: string): Promise<void> {
  await sendLiteral(pane.name, text);
  await sendKeys(pane.name, ["Enter"]);
}

void test("the fake claude paints the prompt and repaints when the scenario changes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-claude-tui-"));
  const scenario = path.join(dir, "scenario.txt");
  fs.writeFileSync(scenario, "ROW-ONE-A\nROW-TWO-A");
  const bin = writeFakeClaudeTui(dir);
  const child = spawnPiped(bin, ["--ignored"], {
    env: { FAKE_CLAUDE_SCENARIO: scenario },
  });
  let out = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    out += chunk.toString();
  });
  try {
    await until(() => out.includes("ROW-TWO-A"));
    assert.ok(out.includes("❯ "));
    assert.ok(out.includes("ROW-ONE-A\nROW-TWO-A"));
    fs.writeFileSync(scenario, "ROW-ONE-B\nROW-TWO-B");
    await until(() => out.includes("ROW-TWO-B"));
    assert.ok(out.includes("ROW-ONE-B\nROW-TWO-B"));
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test(
  "in a tmux pane the fake shows the ready prompt and the status rows",
  { skip: !hasTmux, timeout: 5000 },
  async () => {
    const pane = await startPane("fake-ready", {
      statusRows: ["STATUS-ONE", "STATUS-TWO"],
    });
    try {
      await until(async () => (await pane.screen()).includes("STATUS-TWO"));
      const screen = await pane.screen();
      assert.ok(screen.includes("❯"));
      assert.ok(screen.includes("STATUS-ONE"));
      assert.ok(screen.includes("STATUS-TWO"));
    } finally {
      await stopPane(pane);
    }
  },
);

void test(
  "a typed line lands in the transcript as one user and one assistant entry",
  { skip: !hasTmux, timeout: 5000 },
  async () => {
    const pane = await startPane("fake-typed", { statusRows: ["a", "b"] });
    try {
      await until(async () => (await pane.screen()).includes("❯"));
      await type(pane, "hello fake");
      await until(() => readJsonl(pane.transcript).length >= 2);
      const entries = readJsonl(pane.transcript);
      assert.equal(entries.length, 2);
      assert.equal(entries[0]?.type, "user");
      assert.deepEqual(entries[0]?.message, {
        role: "user",
        content: "hello fake",
      });
      assert.equal(entries[1]?.type, "assistant");
      assert.deepEqual(entries[1]?.message, {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
      });
    } finally {
      await stopPane(pane);
    }
  },
);

void test(
  "Down then Enter in a dialog logs the second row and closes the dialog",
  { skip: !hasTmux, timeout: 5000 },
  async () => {
    const pane = await startPane("fake-dialog", {
      statusRows: ["a", "b"],
      dialog: { title: "Pick one", rows: ["first row", "second row"] },
    });
    try {
      await until(async () => (await pane.screen()).includes("second row"));
      assert.ok((await pane.screen()).includes("❯ first row"));
      await sendKeys(pane.name, ["Down"]);
      await until(async () => (await pane.screen()).includes("❯ second row"));
      await sendKeys(pane.name, ["Enter"]);
      await until(() => readJsonl(pane.keyLog).some((l) => l.key === "enter"));
      const log = readJsonl(pane.keyLog);
      assert.deepEqual(
        log.map((l) => [l.key, l.row]),
        [
          ["down", "second row"],
          ["enter", "second row"],
        ],
      );
      await until(async () => !(await pane.screen()).includes("Pick one"));
      assert.ok(!(await pane.screen()).includes("Pick one"));
    } finally {
      await stopPane(pane);
    }
  },
);

void test(
  "while warming up the fake shows the status and ignores typed input",
  { skip: !hasTmux, timeout: 5000 },
  async () => {
    const pane = await startPane("fake-warm", {
      statusRows: ["STATUS-ONE", "STATUS-TWO"],
      warmingUpMs: 1500,
    });
    try {
      await until(async () => (await pane.screen()).includes("warming up"));
      assert.ok((await pane.screen()).includes("warming up"));
      await type(pane, "too early");
      await until(async () => !(await pane.screen()).includes("warming up"));
      assert.ok((await pane.screen()).includes("STATUS-ONE"));
      assert.deepEqual(readJsonl(pane.transcript), []);
      await type(pane, "on time");
      await until(() => readJsonl(pane.transcript).length >= 2);
      const entries = readJsonl(pane.transcript);
      assert.equal(entries.length, 2);
      assert.deepEqual(entries[0]?.message, {
        role: "user",
        content: "on time",
      });
    } finally {
      await stopPane(pane);
    }
  },
);

interface ReplayRun {
  lines: Record<string, unknown>[];
}

interface ReplayOptions {
  token?: string;
  env?: Record<string, string>;
  drive?: (write: (text: string) => void, log: string) => Promise<void>;
}

/** Type the kickoff line and wait for the first finished stage. */
async function kickoff(
  write: (text: string) => void,
  log: string,
): Promise<void> {
  write("kickoff\r");
  await until(() => readJsonl(log).some((l) => l.done === true), 40000);
}

async function runReplay(
  name: string,
  script: Record<string, unknown>,
  opts: ReplayOptions = {},
): Promise<ReplayRun> {
  const dir = fs.mkdtempSync(path.join(env.root, `replay-${name}-`));
  const log = path.join(dir, "replay.jsonl");
  const scenarioFile = path.join(dir, "scenario.json");
  const config = path.join(dir, "mcp.json");
  fs.writeFileSync(
    scenarioFile,
    JSON.stringify({
      replayLogPath: log,
      replay: script,
    }),
  );
  fs.writeFileSync(
    config,
    JSON.stringify({
      mcpServers: {
        dispatch: {
          command: process.execPath,
          args: [
            "--import",
            "tsx",
            path.resolve("src/server/bootstrap/cli.ts"),
            "mcp",
          ],
        },
      },
    }),
  );
  const bin = writeFakeClaudeTui(dir);
  const child = spawnPiped(bin, ["--mcp-config", config], {
    env: {
      ...opts.env,
      FAKE_CLAUDE_SCENARIO: scenarioFile,
      DISPATCH_ORCHESTRATOR_TOKEN: opts.token ?? replayToken,
      DISPATCH_PORT: String(apiPort),
    },
  });
  child.stdout?.resume();
  child.stderr?.resume();
  const exited = new Promise<void>((resolve) => child.once("exit", resolve));
  try {
    await (opts.drive ?? kickoff)((text) => child.stdin?.write(text), log);
    return { lines: readJsonl(log) };
  } finally {
    child.stdin?.write("\x03");
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    child.kill("SIGKILL");
  }
}

void test(
  "a replay script calls the tools through the real MCP server and logs each result",
  { timeout: 60000 },
  async () => {
    const { lines } = await runReplay("pass", {
      onStart: [
        { tool: "read_state", args: {} },
        { tool: "write_state", args: { markdown: "replay marker one" } },
        {
          tool: "read_state",
          args: {},
          expect: { contains: "replay marker one" },
        },
        {
          tool: "create_ticket",
          args: { proposalItemId: "no-such-proposal", index: 0 },
          expect: { isError: true, contains: "unknown-proposal" },
        },
      ],
    });
    assert.equal(lines.length, 5);
    assert.deepEqual(
      lines.slice(0, 4).map((l) => [l.step, l.tool, l.ok, l.expectMet]),
      [
        [1, "read_state", true, true],
        [2, "write_state", true, true],
        [3, "read_state", true, true],
        [4, "create_ticket", true, true],
      ],
    );
    assert.equal(lines[3]?.isError, true);
    assert.match(String(lines[2]?.excerpt), /replay marker one/);
    assert.equal(lines[4]?.done, true);
    assert.equal(lines[4]?.stopped, undefined);
  },
);

void test(
  "a replay resolves saved references and stops at the first unmet expectation",
  { timeout: 60000 },
  async () => {
    const { lines } = await runReplay("stop", {
      onStart: [
        { tool: "write_state", args: { markdown: "ref-source" } },
        { tool: "read_state", args: {}, saveAs: "saved" },
        { tool: "write_state", args: { markdown: "$saved.markdown!" } },
        { tool: "read_state", args: {}, expect: { contains: "ref-source!" } },
        { tool: "read_state", args: {}, expect: { isError: true } },
        { tool: "write_state", args: { markdown: "never written" } },
      ],
    });
    assert.deepEqual(
      lines.map((l) => l.expectMet ?? l.done),
      [true, true, true, true, false, true],
    );
    assert.equal(lines.at(-1)?.stopped, true);
    assert.equal(
      lines.some((l) => l.step === 6),
      false,
    );
  },
);

const SCRIPTS = "src/server/test-support/fixtures/orchestrator-scripts";

function fixtureScript(file: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(SCRIPTS, file), "utf8"),
  ) as Record<string, unknown>;
}

void test(
  "the intake-early fixture is refused with proposal-open while the proposal is unanswered",
  { timeout: 60000 },
  async () => {
    const { lines } = await runReplay(
      "early",
      fixtureScript("intake-early.json"),
    );
    assert.deepEqual(
      lines.map((l) => l.expectMet ?? l.done),
      [true, true, true],
    );
    assert.match(String(lines[1]?.excerpt), /proposal-open/);
  },
);

void test(
  "the intake fixture creates both tickets once the user approves the proposal",
  { timeout: 60000 },
  async () => {
    store.appendOrchestrationEvent({
      boardKey: REPLAY_BOARD,
      cardId: null,
      sessionId: null,
      kind: "intake_submitted",
      data: {},
      ts: new Date().toISOString(),
    });
    const deadline = Date.now() + 40000;
    const answered = (async () => {
      while (Date.now() < deadline) {
        const open = store
          .listDecisionItems(REPLAY_BOARD, "open")
          .find((item) => item.question.includes("these two tickets"));
        if (open) {
          answerDecisionItem(open.id, { optionId: "approve", note: null });
          return true;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    })();
    const { lines } = await runReplay("intake", fixtureScript("intake.json"));
    assert.equal(await answered, true);
    assert.deepEqual(
      lines.map((l) => l.expectMet ?? l.done),
      [true, true, true, true, true, true, true, true],
    );
    assert.equal(lines.at(-1)?.stopped, undefined);
  },
);

/** A group card on `board` with a live session, so a tool that sends to its loop can reach it. */
async function liveGroup(board: BoardKey, title: string): Promise<string> {
  const a = await store.createLocalCard(board, `${title} a`, "");
  const b = await store.createLocalCard(board, `${title} b`, "");
  const made = await store.createGroupCard(board, title, [a.id, b.id]);
  assert.ok(made.ok);
  await store.completeStart(made.card.id, undefined, {
    workspacePath: `/rpl/sessions/${made.card.id}`,
    branch: made.card.id,
    tmuxSession: `dsp-${made.card.id}`,
  });
  return made.card.id;
}

void test(
  "the ask-approval fixture approves the roadmap only after the user answers the decision item",
  { timeout: 90000 },
  async () => {
    const group = await liveGroup(REPLAY_BOARD, "ask group");
    const policy = store.getBoard(REPLAY_BOARD)!.policy;
    await store.setBoardPolicy(REPLAY_BOARD, {
      ...policy,
      roadmapApproval: "ask",
    });
    const sent: string[] = [];
    const keepSend = sessionTools.send;
    sessionTools.send = (_card, _session, text) => {
      sent.push(text);
      return Promise.resolve("confirmed");
    };
    let itemId: string | undefined;
    const deadline = Date.now() + 40000;
    const answered = (async () => {
      while (Date.now() < deadline) {
        const open = store
          .listDecisionItems(REPLAY_BOARD, "open")
          .find((item) => item.cardId === group);
        if (open) {
          await new Promise((r) => setTimeout(r, 500));
          assert.deepEqual(sent, []);
          itemId = open.id;
          answerDecisionItem(open.id, { optionId: "approve", note: null });
          return true;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    })();
    try {
      const { lines } = await runReplay(
        "ask",
        fixtureScript("ask-approval.json"),
        { env: { REPLAY_GROUP_ID: group } },
      );
      assert.equal(await answered, true);
      assert.deepEqual(
        lines.map((l) => [l.tool ?? "done", l.expectMet ?? l.done]),
        [
          ["get_policy", true],
          ["list_events", true],
          ["create_decision_item", true],
          ["wait_for_event", true],
          ["approve_roadmap", true],
          ["write_state", true],
          ["done", true],
        ],
      );
      assert.match(String(lines[4]?.excerpt), /confirmed/);
      assert.deepEqual(sent, [
        `Roadmap approved (decisions ${itemId}). Continue the loop.`,
      ]);
      const item = store
        .listDecisionItems(REPLAY_BOARD, "answered")
        .find((i) => i.id === itemId);
      assert.ok(item?.consumedAt);
    } finally {
      sessionTools.send = keepSend;
      await store.setBoardPolicy(REPLAY_BOARD, policy);
    }
  },
);

void test(
  "the clear-resume fixture reads the same state back in the afterClear stage after /clear",
  { timeout: 90000 },
  async () => {
    const group = await liveGroup(REPLAY_BOARD, "clear group one");
    const group2 = await liveGroup(REPLAY_BOARD, "clear group two");
    const decision = createDecisionItem(
      { boardKey: REPLAY_BOARD, orchestratorId: "main" },
      {
        cardId: group,
        kind: "other",
        question: "Which base branch should group two use?",
        options: [
          { id: "main", label: "main" },
          { id: "develop", label: "develop" },
        ],
      },
    );
    const script = fixtureScript("clear-resume.json") as {
      onStart: Record<string, unknown>[];
    };
    const fast = {
      ...script,
      onStart: script.onStart.map((step) =>
        typeof step.sleepMs === "number" ? { sleepMs: 50 } : step,
      ),
    };
    const stageDone = (log: string, phase: string) =>
      readJsonl(log).some((l) => l.done === true && l.phase === phase);
    const { lines } = await runReplay("clear", fast, {
      env: {
        REPLAY_GROUP_ID: group,
        REPLAY_GROUP2_ID: group2,
        REPLAY_DECISION_ID: decision.id,
      },
      drive: async (write, log) => {
        write("kickoff\r");
        await until(() => stageDone(log, "onStart"), 40000);
        assert.equal(
          readJsonl(log).some((l) => l.phase === "afterClear"),
          false,
        );
        write("/clear\r");
        await new Promise((r) => setTimeout(r, 200));
        write("Resume from the state file.\r");
        await until(() => stageDone(log, "afterClear"), 40000);
      },
    });
    assert.deepEqual(
      lines.map((l) => [l.tool ?? l.phase, l.expectMet ?? l.done]),
      [
        ["write_state", true],
        ["write_state", true],
        ["onStart", true],
        ["read_state", true],
        ["list_cards", true],
        ["list_events", true],
        ["afterClear", true],
      ],
    );
    assert.equal(
      lines.some((l) => l.stopped === true),
      false,
    );
    assert.match(String(lines[3]?.excerpt), new RegExp(group2));
    assert.match(String(lines[3]?.excerpt), new RegExp(decision.id));
    assert.equal(
      store
        .listDecisionItems(REPLAY_BOARD, "open")
        .some((i) => i.id === decision.id),
      true,
    );
  },
);

void test(
  "the second-claim fixture run by a second extra is refused with other-owner and starts nothing",
  { timeout: 60000 },
  async () => {
    const CLM = parseBoardKey("CLM") as BoardKey;
    await store.createBoard({
      key: CLM,
      name: "Claim",
      workspaceRoot: "/clm/sessions",
      repositories: [],
      linearTeamKeys: [],
    });
    const a = await store.createLocalCard(CLM, "claim a", "");
    const b = await store.createLocalCard(CLM, "claim b", "");
    const made = await store.createGroupCard(CLM, "claimed", [a.id, b.id]);
    assert.ok(made.ok);
    const group = made.card.id;
    const other = await store.createLocalCard(CLM, "e2 ticket", "");
    const extra = (id: string, scope: OrchestratorRecord["scope"]) => ({
      ...mainRecord,
      id,
      name: id,
      role: "extra" as const,
      scope,
    });
    await store.setBoardOrchestrators(CLM, [
      mainRecord,
      extra("e1", { groupIds: [group], ticketIds: [] }),
      extra("e2", { groupIds: [], ticketIds: [other.id] }),
    ]);
    const token = mintOrchestratorToken({
      boardKey: CLM,
      orchestratorId: "e2",
    });
    const before = JSON.stringify(store.getCard(group));
    const { lines } = await runReplay(
      "claim",
      fixtureScript("second-claim.json"),
      { token, env: { REPLAY_GROUP_ID: group } },
    );
    assert.deepEqual(
      lines.map((l) => [l.tool ?? "done", l.expectMet ?? l.done]),
      [
        ["start_group", true],
        ["done", true],
      ],
    );
    assert.equal(lines[0]?.isError, true);
    assert.match(String(lines[0]?.excerpt), /other-owner/);
    assert.equal(JSON.stringify(store.getCard(group)), before);
  },
);
