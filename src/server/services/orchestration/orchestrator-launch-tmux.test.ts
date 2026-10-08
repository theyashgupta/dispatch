import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isolateTmuxEnv,
  readArgv,
  waitFor,
} from "../../test-support/fixtures.js";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";

const env = await isolateTmuxEnv();
const tmux = await import("../../adapters/tmux.js");
const { store } = await import("../../store/board.store.js");
const { DISPATCH_DATA_DIR } = await import("../../store/data-dir.js");
const { launchClaude } = await import("./steps.js");
const { runClaude } = await import("./run-claude.js");
const { resolveOrchestratorToken } = await import("./orchestrator-tokens.js");
const { setHooksRuntime } = await import("../infra/config-holder.js");
setHooksRuntime({ capable: true, port: 4711, statusChannel: "auto" });

void test(
  "an orchestrator session gets its policy argv and a token in its env, and a relaunch hands the shell a new token without typing it",
  { skip: !env.canRunRealTmux },
  async () => {
    const argvFile = path.join(env.root, "claude-argv.txt");
    const envFile = path.join(env.root, "claude-env.txt");
    fs.writeFileSync(
      path.join(env.binDir, "claude"),
      `#!/bin/sh
printf '%s\\n' "$@" > '${argvFile}'
printf '%s %s\\n' "$DISPATCH_ORCHESTRATOR_TOKEN" "$DISPATCH_PORT" > '${envFile}'
echo "? for shortcuts"
trap 'exit 0' INT
while :; do sleep 1; done
`,
      { mode: 0o755 },
    );
    const SBX = parseBoardKey("SBX") as BoardKey;
    await store.load();
    await store.createBoard({
      key: SBX,
      name: "Sandbox",
      workspaceRoot: path.join(env.root, "sessions"),
      repositories: [],
      linearTeamKeys: [],
    });
    const card = await store.createOrchestratorCard(
      SBX,
      "Orchestrator: Lead",
      "lead",
    );
    const tmuxSession = `dsp-orch-${process.pid}`;
    const target = `=${tmuxSession}:`;
    const cwd = path.join(env.root, "sessions", card.id);
    fs.mkdirSync(cwd, { recursive: true });
    const readEnv = () => fs.readFileSync(envFile, "utf8").trim().split(" ");

    try {
      await launchClaude({
        cardId: card.id,
        tmuxSession,
        cwd,
        leadingArgs: [],
        account: { id: "default" },
      });
      await store.completeStart(card.id, undefined, {
        workspacePath: cwd,
        tmuxSession,
        branch: card.id,
      });
      const argv = readArgv(argvFile) ?? [];
      assert.equal(argv[0], "--model");
      assert.ok(argv.includes("--strict-mcp-config"));
      assert.deepEqual(
        argv.slice(
          argv.indexOf("--disallowedTools") + 1,
          argv.indexOf("--disallowedTools") + 5,
        ),
        ["Bash", "Write", "Edit", "NotebookEdit"],
      );
      assert.equal(
        argv.some((a) => a.includes("dangerously")),
        false,
      );
      const [first, port] = readEnv();
      assert.equal(port, "4711");
      assert.equal(resolveOrchestratorToken(first)?.revoked, false);

      await tmux.sendKeys(target, ["C-c"]);
      await waitFor(() => tmux.paneAtPrompt(target), 5000, "shell prompt");
      fs.rmSync(envFile, { force: true });
      assert.equal(await runClaude(card.id), "launched");
      await waitFor(
        () => Promise.resolve(fs.existsSync(envFile)),
        5000,
        "relaunch env",
      );
      const [second] = readEnv();
      assert.notEqual(second, first);
      assert.equal(resolveOrchestratorToken(first)?.revoked, true);
      assert.equal(resolveOrchestratorToken(second)?.revoked, false);
      assert.deepEqual(
        fs
          .readdirSync(path.join(DISPATCH_DATA_DIR, "orchestrators"))
          .filter((f) => f.endsWith(".activate.sh")),
        [],
      );
      const pane = await tmux.captureHistory(target, 500).catch(() => "");
      assert.equal(
        pane.includes(second),
        false,
        "the pane never shows the token",
      );
    } finally {
      await env.killServer();
      env.cleanup();
    }
  },
);
