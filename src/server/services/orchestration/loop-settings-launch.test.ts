import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import { installFakeTmux } from "../../test-support/fake-tmux.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

const env = isolateEnv();
const fake = installFakeTmux(env);

const { setHooksRuntime } = await import("../infra/config-holder.js");
const accounts = await import("./claude-accounts.js");
const { launchClaude } = await import("./steps.js");
const { store } = await import("../../store/board.store.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });

const ID = "55555555-5555-4555-8555-555555555555";
const workspace = path.join(env.root, "ws");
const homeSettings = path.join(env.home, ".claude", "settings.json");
fs.mkdirSync(workspace);
fs.writeFileSync(homeSettings, '{"theme":"dark"}\n');

await accounts.upsertAccount({
  id: ID,
  email: "new@example.com",
  orgId: "org",
  orgName: "Org",
  subscriptionType: "max",
  createdAt: "2026-10-23T00:00:00.000Z",
  lastLoginAt: "2026-10-23T00:00:00.000Z",
});
fs.mkdirSync(accounts.accountDir(ID), { recursive: true, mode: 0o700 });
await store.load();

void test("a session start on a new account dir leaves both loop settings in its settings.json", async () => {
  const card = await store.createLocalCard(DEFAULT_BOARD_KEY, "new-acct", "");
  fake.reset({ "at-prompt": "" });
  await launchClaude({
    cardId: card.id,
    tmuxSession: "dsp-new-acct",
    cwd: workspace,
    leadingArgs: [],
    account: await accounts.resolveLaunchAccount(ID),
  });
  const file = path.join(accounts.accountDir(ID), "settings.json");
  assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
    theme: "dark",
    idleCompaction: false,
    promptSuggestionEnabled: false,
  });
});

void test.after(() => env.cleanup());
