import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import { installFakeTmux } from "../../test-support/fake-tmux.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

const env = isolateEnv();
const fake = installFakeTmux(env);
const state = fake.state;

const { store } = await import("../../store/board.store.js");
const { upsertAccount, accountDir } = await import("./claude-accounts.js");
const { moveSessionAccount } = await import("./session-account-move.js");
const { recordTurnEvent } = await import("./session-turn.js");
const { withCardLock } = await import("./run-claude.js");
const { accountEnvLine } = await import("../domain/claude-launch.js");
const { resolveBinaryPath } = await import("../../adapters/resolve-binary.js");
const { setHooksRuntime } = await import("../infra/config-holder.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });

const END_OF_OPTIONS = "-".repeat(2);
const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
for (const id of [ACCOUNT_A, ACCOUNT_B]) {
  await upsertAccount({
    id,
    email: `${id.slice(0, 4)}@example.com`,
    orgId: "org",
    orgName: "Org",
    subscriptionType: "max",
    createdAt: "2026-10-01T00:00:00.000Z",
    lastLoginAt: "2026-10-01T00:00:00.000Z",
  });
  fs.mkdirSync(accountDir(id), { recursive: true });
}
const CLAUDE = (await resolveBinaryPath("claude")) ?? "claude";
const workspace = path.join(env.root, "ws");
fs.mkdirSync(workspace);
await store.load();

/** The logged tmux calls as argv arrays, without the pane-root polls whose count is timing bound. */
function calls(): string[][] {
  const log = path.join(state, "calls.log");
  if (!fs.existsSync(log)) return [];
  return fs
    .readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter((l) => l !== "" && !l.startsWith("display-message"))
    .map((l) => l.split("\t"));
}

/** Create a card whose active session runs in tmux session `S` on `accountId` with a recorded conversation. */
async function sessionCard(
  title: string,
  accountId = "default",
  conversation: string | null = "conv-1",
) {
  const created = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: workspace,
    tmuxSession: `dsp-${title}`,
    branch: title,
    claudeAccountId: accountId,
  });
  if (conversation !== null) {
    await store.setClaudeSessionId(created.id, undefined, conversation);
  }
  const card = store.getCard(created.id)!;
  return {
    cardId: card.id,
    sessionId: card.activeSessionId!,
    s: `dsp-${title}`,
  };
}

const accountOf = (cardId: string, sessionId: string) =>
  store.getCard(cardId)?.sessions?.find((x) => x.id === sessionId)
    ?.claudeAccountId;

const trustOf = (file: string) =>
  (
    JSON.parse(fs.readFileSync(file, "utf8")) as {
      projects?: Record<string, { hasTrustDialogAccepted?: boolean }>;
    }
  ).projects?.[workspace]?.hasTrustDialogAccepted;

/** The exact calls of a move that stops an idle Claude and relaunches it on `configDir`. */
function moveCalls(
  s: string,
  configDir: string | undefined,
  resume = "conv-1",
) {
  return [
    ["has-session", "-t", `=${s}`],
    ["show-environment", "-t", `=${s}`, "DISPATCH_SHELL_SESSION"],
    ["capture-pane", "-p", "-t", `=${s}:`],
    ["send-keys", "-l", "-t", `=${s}:`, END_OF_OPTIONS, "/exit"],
    ["send-keys", "-t", `=${s}:`, "Enter"],
    configDir === undefined
      ? ["set-environment", "-u", "-t", `=${s}`, "CLAUDE_CONFIG_DIR"]
      : ["set-environment", "-t", `=${s}`, "CLAUDE_CONFIG_DIR", configDir],
    ["send-keys", "-t", `=${s}:`, "C-u"],
    [
      "send-keys",
      "-l",
      "-t",
      `=${s}:`,
      END_OF_OPTIONS,
      configDir === undefined
        ? "unset CLAUDE_CONFIG_DIR"
        : `export CLAUDE_CONFIG_DIR='${configDir}'`,
    ],
    ["send-keys", "-t", `=${s}:`, "Enter"],
    ["send-keys", "-t", `=${s}:`, "C-u", "C-l"],
    ["capture-pane", "-p", "-t", `=${s}:`],
    [
      "send-keys",
      "-l",
      "-t",
      `=${s}:`,
      END_OF_OPTIONS,
      `'${CLAUDE}' '--resume' '${resume}' '--dangerously-skip-permissions'`,
    ],
    ["send-keys", "-t", `=${s}:`, "Enter"],
    ["capture-pane", "-p", "-t", `=${s}:`],
    ...(resume.startsWith("missing-")
      ? []
      : [["capture-pane", "-p", "-t", `=${s}:`]]),
  ];
}

void test("Default to added: stops idle Claude, sets the variable, seeds trust before the launch, resumes the same conversation", async () => {
  const { cardId, sessionId, s } = await sessionCard("move-da");
  const dirA = accountDir(ACCOUNT_A);
  process.env.FAKE_TRUST_PROBE = path.join(dirA, ".claude.json");
  fake.reset();
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "moved");
  assert.deepEqual(calls(), moveCalls(s, dirA));
  assert.equal(accountOf(cardId, sessionId), ACCOUNT_A);
  assert.equal(
    trustOf(path.join(state, "trust-at-launch")),
    true,
    "the new config folder trusts the workspace when the launch line is typed",
  );
});

void test("added to added, then added to Default", async () => {
  const { cardId, sessionId, s } = await sessionCard("move-ab", ACCOUNT_A);
  const dirB = accountDir(ACCOUNT_B);
  process.env.FAKE_TRUST_PROBE = path.join(dirB, ".claude.json");
  fake.reset();
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_B, sessionId), "moved");
  assert.deepEqual(calls(), moveCalls(s, dirB));
  assert.equal(accountOf(cardId, sessionId), ACCOUNT_B);
  assert.equal(trustOf(path.join(state, "trust-at-launch")), true);

  process.env.FAKE_TRUST_PROBE = path.join(env.home, ".claude.json");
  fake.reset();
  assert.equal(await moveSessionAccount(cardId, "default"), "moved");
  assert.deepEqual(calls(), moveCalls(s, undefined));
  assert.equal(accountOf(cardId, sessionId), "default");
  assert.equal(trustOf(path.join(state, "trust-at-launch")), true);
});

void test("a shell already at its prompt skips the /exit", async () => {
  const { cardId, s } = await sessionCard("move-prompt");
  fake.reset({ "at-prompt": "" });
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "moved");
  const expected = moveCalls(s, accountDir(ACCOUNT_A)).filter(
    (c, i) => i < 2 || i > 4,
  );
  assert.deepEqual(calls(), expected);
});

void test("same account returns same and types nothing", async () => {
  const { cardId, s } = await sessionCard("move-same", ACCOUNT_A);
  fake.reset();
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "same");
  assert.deepEqual(calls(), [
    ["has-session", "-t", `=${s}`],
    ["show-environment", "-t", `=${s}`, "DISPATCH_SHELL_SESSION"],
  ]);
  const onDefault = await sessionCard("move-same-default");
  fake.reset();
  assert.equal(await moveSessionAccount(onDefault.cardId, "default"), "same");
});

void test("refusals change nothing: busy pane, busy hook, limit, legacy, unknown account", async () => {
  const { cardId, sessionId, s } = await sessionCard("move-refuse");
  const unchanged = () => {
    assert.equal(accountOf(cardId, sessionId), "default");
    assert.equal(
      calls().some((c) => c[0] === "send-keys" || c[0] === "set-environment"),
      false,
      "no key and no variable reach the session",
    );
  };

  fake.reset({ pane: "* Working... (esc to interrupt)\n? for shortcuts" });
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "busy");
  unchanged();

  fake.reset();
  recordTurnEvent(cardId, sessionId, "UserPromptSubmit", undefined);
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "busy");
  unchanged();
  recordTurnEvent(cardId, sessionId, "Stop", undefined);

  fake.reset({ pane: "What now?\n ❯ 1. Switch to usage credits\n" });
  assert.equal(
    await moveSessionAccount(cardId, ACCOUNT_A),
    "busy",
    "no input footer: not a safe point",
  );
  unchanged();

  fake.reset({
    pane: "What do you want to do?\n\n ❯ 1. Switch to usage credits\n   2. Upgrade your plan\n",
  });
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "limit-unknown");
  unchanged();

  fake.reset({ legacy: "" });
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "legacy");
  unchanged();

  fake.reset();
  assert.equal(
    await moveSessionAccount(cardId, "33333333-3333-4333-8333-333333333333"),
    "account",
  );
  assert.equal(await moveSessionAccount(cardId, "../etc"), "account");
  unchanged();

  fake.reset({ [`dead.${s}`]: "" });
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "no-session");
  assert.equal(
    await moveSessionAccount("no-such-card", ACCOUNT_A),
    "no-session",
  );
  unchanged();
});

void test("a start, relaunch or move in flight returns busy before any tmux call", async () => {
  const { cardId, sessionId } = await sessionCard("move-lock");
  fake.reset();
  store.beginStart(cardId);
  try {
    assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "busy");
  } finally {
    store.endStart(cardId);
  }
  let release!: () => void;
  const held = withCardLock(
    cardId,
    () => new Promise<void>((r) => (release = r)),
  );
  try {
    assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "busy");
  } finally {
    release();
    await held;
  }
  assert.deepEqual(calls(), []);
  assert.equal(accountOf(cardId, sessionId), "default");
});

void test("a shell that does not return within 15 s returns busy and changes nothing else", async () => {
  const { cardId, sessionId } = await sessionCard("move-stuck");
  fake.reset({ stuck: "" });
  const started = Date.now();
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "busy");
  assert.ok(Date.now() - started >= 15_000);
  assert.deepEqual(
    calls()
      .filter((c) => c[0] === "send-keys" || c[0] === "set-environment")
      .map((c) => c.at(-1)),
    ["/exit", "Enter"],
  );
  assert.equal(accountOf(cardId, sessionId), "default");
});

void test("an exit menu for running background work gets Escape, so the work stays and the move is busy", async () => {
  const { cardId, sessionId } = await sessionCard("move-bg");
  fake.reset({
    stuck: "",
    "next.dsp-move-bg.1":
      "Background work is running\n\u276f 1. Exit and stop tasks\n  2. Move to background and exit\n  3. Stay\n",
  });
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "busy");
  assert.deepEqual(
    calls()
      .filter((c) => c[0] === "send-keys" || c[0] === "set-environment")
      .map((c) => c.at(-1)),
    ["/exit", "Enter", "Escape"],
  );
  assert.equal(accountOf(cardId, sessionId), "default");
});

void test("a missing conversation is marked missing after the move", async () => {
  const { cardId, sessionId, s } = await sessionCard(
    "move-missing",
    "default",
    "missing-9",
  );
  fake.reset();
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "moved");
  assert.deepEqual(calls(), moveCalls(s, accountDir(ACCOUNT_A), "missing-9"));
  const node = store
    .getCard(cardId)
    ?.sessions?.find((x) => x.id === sessionId)
    ?.claudeSessions?.find((n) => n.id === "missing-9");
  assert.equal(typeof node?.missingAt, "string");
  assert.equal(accountOf(cardId, sessionId), ACCOUNT_A);
});

void test("a session with no recorded conversation relaunches with a bare launch line", async () => {
  const { cardId } = await sessionCard("move-bare", "default", null);
  fake.reset();
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "moved");
  const typed = calls()
    .filter((c) => c[1] === "-l")
    .map((c) => c.at(-1) ?? "");
  const launch = typed.at(-1) ?? "";
  assert.equal(launch.includes("--resume"), false, launch);
  assert.equal(launch.includes("--continue"), false, launch);
});

void test("the pane footer decides the safe point, not text higher up the pane", async () => {
  const { cardId, sessionId } = await sessionCard("move-footer");
  fake.reset({
    pane: [
      "? for shortcuts",
      "earlier output",
      "Do you want to proceed?",
      " ❯ 1. Yes",
      "   2. Yes, and don't ask again",
      "   3. No",
      "",
      "Esc to cancel",
    ].join("\n"),
  });
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "busy");
  assert.equal(
    calls().some((c) => c[0] === "send-keys" || c[0] === "set-environment"),
    false,
  );
  assert.equal(accountOf(cardId, sessionId), "default");
});

void test("a pane that never clears still gets the launch line after about 3 s, once the capture polls ran", async () => {
  const { cardId } = await sessionCard("move-stale-ready");
  fake.reset({ sticky: "", "no-clear": "" });
  const started = Date.now();
  assert.equal(await moveSessionAccount(cardId, ACCOUNT_A), "moved");
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 2_900 && elapsed < 8_000, String(elapsed));
  const all = calls();
  const launchAt = all.findIndex((c) => c.at(-1)?.includes("'--resume'"));
  const clearAt = all.findIndex((c) => c.includes("C-l"));
  const polls = all
    .slice(clearAt, launchAt)
    .filter((c) => c[0] === "capture-pane");
  assert.ok(polls.length > 3, String(polls.length));
});

void test("a move records one account_moved row naming both accounts and the cause; a refusal records none", async () => {
  const moved = await sessionCard("move-event");
  const refused = await sessionCard("move-event-busy");
  const rows = (cardId: string) =>
    store
      .listEvents(DEFAULT_BOARD_KEY, cardId, 50)
      .filter((e) => String(e.type) === "account_moved");
  fake.reset();
  assert.equal(await moveSessionAccount(moved.cardId, ACCOUNT_A), "moved");
  assert.equal(
    await moveSessionAccount(
      moved.cardId,
      "default",
      moved.sessionId,
      "turn end",
    ),
    "moved",
  );
  assert.deepEqual(
    rows(moved.cardId)
      .map((e) => e.reason)
      .sort(),
    [
      "1111@example.com to Default, turn end",
      "Default to 1111@example.com, session action",
    ],
  );
  fake.reset({ pane: "* Working... (esc to interrupt)\n? for shortcuts" });
  assert.equal(await moveSessionAccount(refused.cardId, ACCOUNT_A), "busy");
  assert.equal(await moveSessionAccount(refused.cardId, "../etc"), "account");
  assert.deepEqual(rows(refused.cardId), []);
});

void test("the shell line builder quotes the folder and refuses a control byte", () => {
  assert.equal(accountEnvLine(undefined), "unset CLAUDE_CONFIG_DIR");
  assert.equal(
    accountEnvLine("/a b/it's"),
    "export CLAUDE_CONFIG_DIR='/a b/it'\\''s'",
  );
  for (const bad of ["/a\x15b", "/a\x04", "/a\tb", "/a\x7f", "/a\x1b[A"]) {
    assert.throws(() => accountEnvLine(bad), /control character/);
  }
});

void test.after(() => env.cleanup());
