import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CLAUDE_ARGS } from "../../../shared/types.js";
import { buildClaudeLaunch } from "./claude-launch.js";
import { parseClaudeArgs } from "./claude-args.js";
import {
  ORCHESTRATOR_BUILTIN_TOOLS,
  ORCHESTRATOR_DISALLOWED_TOOLS,
  orchestratorLaunchArgs,
  orchestratorMcpConfig,
  orchestratorSessionEnv,
} from "./orchestrator-launch.js";

const input = {
  model: "opus",
  mcpConfigPath: "/data/orchestrators/SBX-main.mcp.json",
};

void test("the leading args hold model, mcp config, strict mode, the read-only tools, the board tool allow, manual mode and the four disallowed tools", () => {
  const { leadingArgs } = orchestratorLaunchArgs({ ...input, claudeArgs: [] });
  assert.deepEqual(leadingArgs, [
    "--model",
    "opus",
    "--mcp-config",
    "/data/orchestrators/SBX-main.mcp.json",
    "--strict-mcp-config",
    "--tools",
    "Read",
    "Glob",
    "Grep",
    "--allowedTools",
    "mcp__dispatch",
    "--permission-mode",
    "manual",
    "--disallowedTools",
    "Bash",
    "Write",
    "Edit",
    "NotebookEdit",
  ]);
  assert.deepEqual(
    [...ORCHESTRATOR_DISALLOWED_TOOLS],
    ["Bash", "Write", "Edit", "NotebookEdit"],
  );
});

void test("the built-in tool allowlist holds no command, code or edit tool", () => {
  for (const tool of [
    "Bash",
    "Monitor",
    "Write",
    "Edit",
    "NotebookEdit",
    "PowerShell",
    "REPL",
    "WebFetch",
  ]) {
    assert.equal(
      (ORCHESTRATOR_BUILTIN_TOOLS as readonly string[]).includes(tool),
      false,
      tool,
    );
  }
});

void test("the default Settings arguments lose the bypass flag", () => {
  const { claudeArgs } = orchestratorLaunchArgs({
    ...input,
    claudeArgs: parseClaudeArgs(DEFAULT_CLAUDE_ARGS),
  });
  assert.deepEqual(claudeArgs, []);
});

void test("every bypass, permission, model, mcp and tool flag is removed in both value forms", () => {
  const { claudeArgs } = orchestratorLaunchArgs({
    ...input,
    claudeArgs: [
      "--dangerously-skip-permissions",
      "--allow-dangerously-skip-permissions",
      "--permission-mode",
      "bypassPermissions",
      "--permission-mode=acceptEdits",
      "--model",
      "haiku",
      "--model=sonnet",
      "--mcp-config",
      "/x.json",
      "/y.json",
      "--strict-mcp-config",
      "--allowedTools",
      "Bash",
      "Edit",
      "--disallowedTools",
      "Read",
      "--tools",
      "default",
      "--tools=Bash",
      "--append-system-prompt",
      "be terse",
      "--verbose",
    ],
  });
  assert.deepEqual(claudeArgs, [
    "--append-system-prompt",
    "be terse",
    "--verbose",
  ]);
});

void test("the built argv holds no bypass flag and keeps resume after the policy flags", () => {
  const { leadingArgs, claudeArgs } = orchestratorLaunchArgs({
    ...input,
    claudeArgs: parseClaudeArgs(DEFAULT_CLAUDE_ARGS),
  });
  const { argv } = buildClaudeLaunch({
    claudePath: "/bin/claude",
    claudeArgs,
    leadingArgs: [...leadingArgs, "--resume", "abc"],
    settingsPath: "/data/hook-settings.json",
    hooks: null,
  });
  assert.equal(
    argv.some((a) => a.includes("dangerously")),
    false,
  );
  assert.equal(argv.filter((a) => a === "--permission-mode").length, 1);
  assert.equal(argv[argv.indexOf("--permission-mode") + 1], "manual");
  assert.ok(argv.indexOf("--resume") > argv.indexOf("--disallowedTools"));
  assert.equal(argv[argv.indexOf("--resume") + 1], "abc");
});

void test("the mcp config names the command and holds no token or env", () => {
  const config = orchestratorMcpConfig({
    command: "/usr/bin/node",
    args: ["--import", "tsx", "/app/cli.ts", "mcp"],
  });
  assert.deepEqual(config, {
    mcpServers: {
      dispatch: {
        command: "/usr/bin/node",
        args: ["--import", "tsx", "/app/cli.ts", "mcp"],
      },
    },
  });
  const text = JSON.stringify(config);
  assert.equal(text.includes("env"), false);
  assert.equal(text.toLowerCase().includes("token"), false);
});

void test("the session env carries the token and the port as text", () => {
  assert.deepEqual(orchestratorSessionEnv({ token: "t0k", port: 4700 }), {
    DISPATCH_ORCHESTRATOR_TOKEN: "t0k",
    DISPATCH_PORT: "4700",
  });
});
