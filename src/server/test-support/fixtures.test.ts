import test from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "./fixtures.js";

const LOOP_SHELL_VARS = {
  CLAUDE_CONFIG_DIR: "/live/account",
  DISPATCH_ACCOUNT_DIRS: "acct-1=/live/second",
  DISPATCH_CARD_ID: "LOCAL-1",
  DISPATCH_HOOK_PORT: "4710",
  DISPATCH_HOOK_TOKEN: "live-token",
  DISPATCH_GITHUB_API_URL: "http://127.0.0.1:1/github",
  DISPATCH_SLACK_API_URL: "http://127.0.0.1:1/slack",
};

void test("isolateEnv clears the loop shell variables a fake claude inherits and restores them on cleanup", async () => {
  const before = Object.fromEntries(
    Object.keys(LOOP_SHELL_VARS).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, LOOP_SHELL_VARS);
  const env = isolateEnv();
  try {
    for (const key of Object.keys(LOOP_SHELL_VARS)) {
      assert.equal(process.env[key], undefined, `${key} is cleared`);
    }
    const { run } = await import("../adapters/exec.js");
    const { stdout } = await run("claude", ["auth", "status"]);
    assert.equal(
      (JSON.parse(stdout) as { email: string }).email,
      "home@example.com",
    );
    const child = await run("/usr/bin/env", []);
    for (const key of Object.keys(LOOP_SHELL_VARS)) {
      assert.doesNotMatch(child.stdout, new RegExp(`^${key}=`, "m"));
    }
  } finally {
    env.cleanup();
  }
  assert.deepEqual(
    Object.fromEntries(
      Object.keys(LOOP_SHELL_VARS).map((key) => [key, process.env[key]]),
    ),
    LOOP_SHELL_VARS,
  );
  for (const [key, value] of Object.entries(before)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
