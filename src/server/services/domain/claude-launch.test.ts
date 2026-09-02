import test from "node:test";
import assert from "node:assert/strict";
import { buildClaudeLaunch } from "./claude-launch.js";

const base = {
  claudePath: "/bin/claude",
  claudeArgs: ["--dangerously-skip-permissions"],
  settingsPath: "/data/hook-settings.json",
};
const hooks = { port: 4700, token: "tok", cardId: "card-1" };

void test("Default account passes no CLAUDE_CONFIG_DIR in either branch", () => {
  assert.deepEqual(buildClaudeLaunch({ ...base, hooks }), {
    argv: [
      "/bin/claude",
      "--settings",
      "/data/hook-settings.json",
      "--dangerously-skip-permissions",
    ],
    env: {
      DISPATCH_HOOK_PORT: "4700",
      DISPATCH_HOOK_TOKEN: "tok",
      DISPATCH_CARD_ID: "card-1",
    },
  });
  assert.deepEqual(buildClaudeLaunch({ ...base, hooks: null }), {
    argv: ["/bin/claude", "--dangerously-skip-permissions"],
    env: {},
  });
});

void test("an added account passes exactly its config dir in both branches", () => {
  const dir = "/data/claude-accounts/11111111-1111-4111-8111-111111111111";
  const withHooks = buildClaudeLaunch({ ...base, hooks, configDir: dir });
  assert.equal(withHooks.env.CLAUDE_CONFIG_DIR, dir);
  assert.equal(withHooks.env.DISPATCH_HOOK_TOKEN, "tok");
  const noHooks = buildClaudeLaunch({ ...base, hooks: null, configDir: dir });
  assert.deepEqual(noHooks.env, { CLAUDE_CONFIG_DIR: dir });
  assert.deepEqual(noHooks.argv, [
    "/bin/claude",
    "--dangerously-skip-permissions",
  ]);
});

void test("resume args lead the argv, before the settings layer", () => {
  const launch = buildClaudeLaunch({
    ...base,
    hooks,
    leadingArgs: ["--resume", "sess-9"],
  });
  assert.deepEqual(launch.argv.slice(0, 5), [
    "/bin/claude",
    "--resume",
    "sess-9",
    "--settings",
    "/data/hook-settings.json",
  ]);
});
