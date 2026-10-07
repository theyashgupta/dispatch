import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv, waitFor } from "../../test-support/fixtures.js";
import { IDLE_PANE, installFakeTmux } from "../../test-support/fake-tmux.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

const env = isolateEnv();
const fake = installFakeTmux(env);

const { store } = await import("../../store/board.store.js");
const { upsertAccount, accountDir } = await import("./claude-accounts.js");
const { moveSessionAccount } = await import("./session-account-move.js");
const { runClaude } = await import("./run-claude.js");
const { typeLaunchLine } = await import("./steps.js");
const { resolveBinaryPath } = await import("../../adapters/resolve-binary.js");
const { setHooksRuntime } = await import("../infra/config-holder.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });

const END_OF_OPTIONS = "-".repeat(2);
const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
await upsertAccount({
  id: ACCOUNT_A,
  email: "a@example.com",
  orgId: "org",
  orgName: "Org",
  subscriptionType: "max",
  createdAt: "2026-10-01T00:00:00.000Z",
  lastLoginAt: "2026-10-01T00:00:00.000Z",
});
fs.mkdirSync(accountDir(ACCOUNT_A), { recursive: true });
const CLAUDE = (await resolveBinaryPath("claude")) ?? "claude";
const workspace = path.join(env.root, "ws");
fs.mkdirSync(workspace);
await store.load();

async function staleSession(title: string, accountId: string, stale: boolean) {
  const created = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: workspace,
    tmuxSession: `dsp-${title}`,
    branch: title,
    claudeAccountId: accountId,
  });
  const sessionId = store.getCard(created.id)!.activeSessionId!;
  await store.setClaudeSessionId(created.id, undefined, "conv-1");
  if (stale) await store.markAccountStale(created.id, sessionId);
  return { cardId: created.id, sessionId, s: `dsp-${title}` };
}

const staleOf = (cardId: string, sessionId: string) =>
  store.getCard(cardId)?.sessions?.find((x) => x.id === sessionId)
    ?.claudeAccountStale === true;

function calls(): string[][] {
  const log = path.join(fake.state, "calls.log");
  if (!fs.existsSync(log)) return [];
  return fs
    .readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter((l) => l !== "" && !l.startsWith("display-message"))
    .map((l) => l.split("\t"));
}

function restartCalls(s: string, envCalls: string[][]) {
  return [
    ["has-session", "-t", `=${s}`],
    ["show-environment", "-t", `=${s}`, "DISPATCH_SHELL_SESSION"],
    ["capture-pane", "-p", "-t", `=${s}:`],
    ["send-keys", "-l", "-t", `=${s}:`, END_OF_OPTIONS, "/exit"],
    ["send-keys", "-t", `=${s}:`, "Enter"],
    ...envCalls,
    ["send-keys", "-t", `=${s}:`, "C-u", "C-l"],
    ["capture-pane", "-p", "-t", `=${s}:`],
    [
      "send-keys",
      "-l",
      "-t",
      `=${s}:`,
      END_OF_OPTIONS,
      `'${CLAUDE}' '--resume' 'conv-1' '--dangerously-skip-permissions'`,
    ],
    ["send-keys", "-t", `=${s}:`, "Enter"],
    ["capture-pane", "-p", "-t", `=${s}:`],
    ["capture-pane", "-p", "-t", `=${s}:`],
  ];
}

void test.beforeEach(() => {
  fake.reset();
});

void test("a stale Default session moved to Default is the restart: full sequence, same conversation, flag cleared", async () => {
  const { cardId, sessionId, s } = await staleSession(
    "r-default",
    "default",
    true,
  );
  assert.equal(await moveSessionAccount(cardId, "default"), "moved");
  assert.deepEqual(
    calls(),
    restartCalls(s, [
      ["set-environment", "-u", "-t", `=${s}`, "CLAUDE_CONFIG_DIR"],
      ["send-keys", "-t", `=${s}:`, "C-u"],
      [
        "send-keys",
        "-l",
        "-t",
        `=${s}:`,
        END_OF_OPTIONS,
        "unset CLAUDE_CONFIG_DIR",
      ],
      ["send-keys", "-t", `=${s}:`, "Enter"],
    ]),
  );
  assert.equal(staleOf(cardId, sessionId), false);
});

void test("a non-stale session moved to its own account still returns same", async () => {
  const { cardId, s } = await staleSession("r-same", "default", false);
  assert.equal(await moveSessionAccount(cardId, "default"), "same");
  assert.deepEqual(calls(), [
    ["has-session", "-t", `=${s}`],
    ["show-environment", "-t", `=${s}`, "DISPATCH_SHELL_SESSION"],
  ]);
});

void test("a move to another account clears the stale flag", async () => {
  const { cardId, sessionId } = await staleSession("r-other", "default", true);
  assert.equal(staleOf(cardId, sessionId), true);
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "moved");
  assert.equal(staleOf(cardId, sessionId), false);
});

void test("a refused restart keeps the flag", async () => {
  const { cardId, sessionId } = await staleSession("r-busy", "default", true);
  fake.reset({ pane: "* Working... (esc to interrupt)\n? for shortcuts" });
  assert.equal(await moveSessionAccount(cardId, "default"), "busy");
  assert.equal(staleOf(cardId, sessionId), true);
});

void test("Run Claude after a failed resume does not mark the good conversation missing", async () => {
  const { cardId, s } = await staleSession("r-stale-missing", "default", false);
  fake.reset({
    "at-prompt": "",
    launched: IDLE_PANE,
    [`pane.${s}`]: "No conversation found with session ID: old\n$ ",
  });
  assert.equal(await runClaude(cardId), "launched");
  await waitFor(
    () =>
      Promise.resolve(
        calls().filter((c) => c[0] === "capture-pane").length >= 3,
      ),
    5000,
    "the readiness poll",
  );
  await new Promise((r) => setTimeout(r, 200));
  const all = calls();
  const clearAt = all.findIndex((c) => c.includes("C-l"));
  const launchAt = all.findIndex((c) => c.at(-1)?.includes("'--resume'"));
  assert.ok(all.slice(clearAt, launchAt).some((c) => c[0] === "capture-pane"));
  const node = store
    .getCard(cardId)
    ?.sessions?.flatMap((x) => x.claudeSessions ?? [])
    .find((n) => n.id === "conv-1");
  assert.equal(node?.missingAt, undefined);
  assert.equal(store.getCard(cardId)?.claudeSessionId, "conv-1");
});

void test("typeLaunchLine types the line after about 3 s when the pane never clears", async () => {
  const { s } = await staleSession("r-never-clears", "default", false);
  fake.reset({
    "no-clear": "",
    [`pane.${s}`]: "No conversation found with session ID: old\n",
  });
  const started = Date.now();
  await typeLaunchLine(s, ["claude"]);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 2_900 && elapsed < 6_000, String(elapsed));
  const typed = calls().filter((c) => c[1] === "-l");
  assert.equal(typed.length, 1);
});
