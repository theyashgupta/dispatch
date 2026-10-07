import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import {
  IDLE_PANE,
  LIMIT_PANE,
  installFakeTmux,
} from "../../test-support/fake-tmux.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

process.env.DISPATCH_USAGE_URL = "http://127.0.0.1:1/usage";
process.env.DISPATCH_LIMIT_CLEAR_MS = "600";
const env = isolateEnv();
const fake = installFakeTmux(env);

const { store } = await import("../../store/board.store.js");
const { upsertAccount, accountDir } = await import("./claude-accounts.js");
const { moveSessionAccount } = await import("./session-account-move.js");
const { recordTurnEvent, recordedTurnState } =
  await import("./session-turn.js");
const { CREDITS_OPTION } = await import("../domain/limit-surface.js");
const { setHooksRuntime } = await import("../infra/config-holder.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });

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
const workspace = path.join(env.root, "ws");
fs.mkdirSync(workspace);
await store.load();

const STOP = "Stop and wait for limit to reset";
const WAIT = "Wait here, then continue automatically at 10:40am";
const CREDITS = "Switch to usage credits";
const UPGRADE = "Upgrade your plan";

/** Draw the options menu the way the fake REPL does, pointer on row `cursor`. */
function menu(options: string[], cursor: number): string {
  const rows = options.map(
    (o, i) => ` ${i === cursor ? "❯" : " "} ${i + 1}. ${o}`,
  );
  return ["What do you want to do?", "", ...rows, ""].join("\n");
}

/** A Default card in tmux session `dsp-<title>` whose pane shows `pane`, then each of `next` per key send. */
async function limitCard(title: string, pane: string, next: string[] = []) {
  fake.reset();
  const s = `dsp-${title}`;
  fs.writeFileSync(path.join(fake.state, `pane.${s}`), pane);
  next.forEach((body, i) =>
    fs.writeFileSync(path.join(fake.state, `next.${s}.${i + 1}`), body),
  );
  const created = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: workspace,
    tmuxSession: s,
    branch: title,
    claudeAccountId: "default",
  });
  await store.setClaudeSessionId(created.id, undefined, "conv-1");
  return {
    cardId: created.id,
    sessionId: store.getCard(created.id)!.activeSessionId!,
  };
}

/** The keys sent to the pane in order: key names as-is, literal text as `literal:<text>`. */
function keysSent(): string[] {
  const log = path.join(fake.state, "calls.log");
  if (!fs.existsSync(log)) return [];
  return fs
    .readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((l) => l.split("\t"))
    .filter((c) => c[0] === "send-keys")
    .map((c) =>
      c[1] === "-l" ? `literal:${c.slice(5).join(" ")}` : c.slice(3).join(" "),
    );
}

const accountOf = (cardId: string, sessionId: string) =>
  store.getCard(cardId)?.sessions?.find((x) => x.id === sessionId)
    ?.claudeAccountId;

const MOVE_KEYS = [
  "literal:/exit",
  "Enter",
  "C-u",
  `literal:export CLAUDE_CONFIG_DIR='${accountDir(ACCOUNT_A)}'`,
  "Enter",
  "C-u C-l",
];

/** Assert the keys are `limitKeys`, then the move keys, then a resume of conv-1 and its Enter. */
function assertMovedAfter(limitKeys: string[]): void {
  const keys = keysSent();
  assert.deepEqual(keys.slice(0, limitKeys.length + MOVE_KEYS.length), [
    ...limitKeys,
    ...MOVE_KEYS,
  ]);
  const launch = keys.at(-2) ?? "";
  assert.match(launch, /'--resume' 'conv-1'/);
  assert.equal(keys.at(-1), "Enter");
  assert.equal(keys.length, limitKeys.length + MOVE_KEYS.length + 2);
}

void test("surface (a): Escape, then the session moves and resumes the same conversation", async () => {
  const { cardId, sessionId } = await limitCard("lim-a", LIMIT_PANE, [
    IDLE_PANE,
  ]);
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "moved");
  assertMovedAfter(["Escape"]);
  assert.equal(accountOf(cardId, sessionId), ACCOUNT_A);
});

void test("surface (b) with the stop row first: Enter alone, then the move", async () => {
  const { cardId, sessionId } = await limitCard(
    "lim-b",
    menu([STOP, WAIT, CREDITS, UPGRADE], 0),
    [IDLE_PANE],
  );
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "moved");
  assertMovedAfter(["Enter"]);
  assert.equal(accountOf(cardId, sessionId), ACCOUNT_A);
});

void test("surface (b) with the credits rows first: arrows past them to the stop row, Enter, then the move", async () => {
  const options = [CREDITS, UPGRADE, STOP, WAIT];
  const { cardId, sessionId } = await limitCard("lim-bc", menu(options, 0), [
    menu(options, 2),
    IDLE_PANE,
  ]);
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "moved");
  assertMovedAfter(["Down Down", "Enter"]);
  assert.equal(accountOf(cardId, sessionId), ACCOUNT_A);
});

void test("the wait row that leaves surface (a) gets one Escape, then the move", async () => {
  const options = [CREDITS, WAIT, UPGRADE];
  const { cardId } = await limitCard("lim-bw", menu(options, 0), [
    menu(options, 1),
    LIMIT_PANE,
    IDLE_PANE,
  ]);
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "moved");
  assertMovedAfter(["Down", "Enter", "Escape"]);
});

void test("surface (b) with no stop or wait row sends no key and returns limit-unknown", async () => {
  const { cardId, sessionId } = await limitCard(
    "lim-nostop",
    menu([CREDITS, UPGRADE], 0),
    [IDLE_PANE],
  );
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "limit-unknown");
  assert.deepEqual(keysSent(), []);
  assert.equal(accountOf(cardId, sessionId), "default");
});

void test("a surface that does not clear returns limit-unknown and never stops Claude", async () => {
  const { cardId, sessionId } = await limitCard("lim-stuck", LIMIT_PANE);
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "limit-unknown");
  assert.deepEqual(keysSent(), ["Escape"]);
  assert.equal(accountOf(cardId, sessionId), "default");

  const options = [CREDITS, STOP];
  const menuStuck = await limitCard("lim-bstuck", menu(options, 0), [
    menu(options, 1),
  ]);
  assert.equal(
    await moveSessionAccount(menuStuck.cardId, ACCOUNT_A),
    "limit-unknown",
  );
  assert.deepEqual(keysSent(), ["Down", "Enter"]);
});

void test("an arrow that does not reach the stop row never presses Enter on a credits row", async () => {
  const options = [CREDITS, UPGRADE, STOP];
  const { cardId, sessionId } = await limitCard("lim-drop", menu(options, 0), [
    menu(options, 0),
  ]);
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "limit-unknown");
  assert.deepEqual(keysSent(), ["Down Down"]);
  assert.equal(CREDITS_OPTION.test(options[0]), true);
  assert.equal(accountOf(cardId, sessionId), "default");
});

void test("a hook limit with no surface left on the pane moves at the safe point and forgets the limit", async () => {
  const { cardId, sessionId } = await limitCard("lim-hook", IDLE_PANE);
  recordTurnEvent(cardId, sessionId, "StopFailure", "rate_limit");
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "moved");
  assertMovedAfter([]);
  assert.equal(recordedTurnState(cardId, sessionId), "unknown");
});

void test.after(() => env.cleanup());
