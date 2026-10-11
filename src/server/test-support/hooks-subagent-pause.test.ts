import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "./fixtures.js";
import { writeFakeClaudeTui } from "./fake-claude-tui.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { spawnPiped } = await import("../adapters/exec.js");
const { setHooksRuntime } = await import("../services/infra/config-holder.js");
const { registerHookToken } =
  await import("../services/orchestration/hook-tokens.js");
const { hooksRouter } = await import("../routes/hooks.route.js");
const express = (await import("express")).default;

setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });
await store.load();

const app = express();
app.use("/api", express.json(), hooksRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const port = (server.address() as { port: number }).port;
after(() => {
  server.close();
  env.cleanup();
});

function readJsonl(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const SUBAGENT = {
  session_id: "conv-subagent-pause",
  agent_id: "a0473ff8813982962",
  agent_type: "code-review",
};

void test(
  "a fake claude whose subagent calls AskUserQuestion keeps the card in progress",
  { timeout: 60000 },
  async () => {
    const created = await store.createLocalCard(
      DEFAULT_BOARD_KEY,
      "subagent-pause",
      "",
    );
    const dir = fs.mkdtempSync(path.join(env.root, "subagent-pause-"));
    await store.completeStart(created.id, undefined, {
      workspacePath: dir,
      tmuxSession: "dsp-subagent-pause-none",
      branch: "subagent-pause",
    });
    const sessionId = store.getCard(created.id)!.activeSessionId!;
    const token = "subagent-pause-token-0123456789";
    registerHookToken(token, created.id, sessionId);

    const log = path.join(dir, "replay.jsonl");
    const scenarioFile = path.join(dir, "scenario.json");
    fs.writeFileSync(
      scenarioFile,
      JSON.stringify({
        replayLogPath: log,
        loop: {
          onStart: [
            {
              hook: {
                hook_event_name: "PreToolUse",
                tool_name: "AskUserQuestion",
                tool_use_id: "toolu_013GFm2RWGDD1px3N5vUaqwr",
                ...SUBAGENT,
              },
            },
            {
              hook: {
                hook_event_name: "PostToolUseFailure",
                tool_name: "AskUserQuestion",
                tool_use_id: "toolu_013GFm2RWGDD1px3N5vUaqwr",
                error: "AskUserQuestion is not available in a subagent",
                ...SUBAGENT,
              },
            },
          ],
        },
      }),
    );
    const cwd = path.join(dir, "cwd");
    fs.mkdirSync(cwd);
    const child = spawnPiped(writeFakeClaudeTui(dir), [], {
      cwd,
      env: {
        FAKE_CLAUDE_SCENARIO: scenarioFile,
        DISPATCH_HOOK_PORT: String(port),
        DISPATCH_HOOK_TOKEN: token,
        DISPATCH_CARD_ID: created.id,
      },
    });
    child.stdout?.resume();
    child.stderr?.resume();
    const exited = new Promise<void>((resolve) => child.once("exit", resolve));
    try {
      child.stdin?.write("kickoff\r");
      const deadline = Date.now() + 40000;
      while (
        !readJsonl(log).some((l) => l.done === true) &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }
    } finally {
      child.stdin?.write("\x03");
      child.kill();
      await exited;
    }

    assert.deepEqual(
      readJsonl(log).map((l) => [l.type, l.ok, l.status, l.done]),
      [
        ["hook", true, 204, undefined],
        ["hook", true, 204, undefined],
        [undefined, undefined, undefined, true],
      ],
    );
    const card = store.getCard(created.id)!;
    assert.equal(
      card.claudeSessionId,
      "conv-subagent-pause",
      "the hook route received the events",
    );
    assert.equal(card.column, "in_progress");
    assert.ok(
      store
        .listEvents(DEFAULT_BOARD_KEY, created.id, 50)
        .every((e) => e.type !== "status_needs_input"),
      "no Needs Input event",
    );
  },
);
