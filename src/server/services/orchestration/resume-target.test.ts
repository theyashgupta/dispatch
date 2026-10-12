import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { ResumeTarget } from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { accountDir } = await import("./claude-accounts.js");
const { projectsDirOf } = await import("../../adapters/transcript.js");
const { recordNewestConversation, resolveResumeTarget } =
  await import("./resume-target.js");
const { setHooksRuntime } = await import("../infra/config-holder.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "pane" });

const ACCOUNT = "33333333-3333-4333-8333-333333333333";
process.env.DISPATCH_ACCOUNT_DIRS = `${ACCOUNT}=${path.join(env.root, "elsewhere")}`;
await store.load();

const pause = () => new Promise((r) => setTimeout(r, 20));

async function card(title: string) {
  const created = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
  const cwd = path.join(env.root, `wt-${title}`);
  fs.mkdirSync(cwd, { recursive: true });
  await store.completeStart(created.id, undefined, {
    workspacePath: cwd,
    tmuxSession: `dsp-${title}`,
    branch: title,
  });
  const sessionId = store.getCard(created.id)!.activeSessionId!;
  return { cardId: created.id, sessionId, cwd };
}

const sessionOf = (ref: { cardId: string; sessionId: string }) =>
  store.getCard(ref.cardId)!.sessions!.find((s) => s.id === ref.sessionId)!;

const touch = (dir: string, id: string) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), "");
};

const sessionIdOf = (target: ResumeTarget) =>
  target.mode === "resume" ? target.sessionId : undefined;

void test("the default account reads the home folder and an added account reads its own", async () => {
  const ref = await card("accounts");
  const home = projectsDirOf(path.join(env.home, ".claude"), ref.cwd);
  const added = projectsDirOf(accountDir(ACCOUNT), ref.cwd);
  touch(home, "home-conv");
  touch(added, "added-conv");

  await store.setSessionAccount(ref.cardId, ref.sessionId, "default");
  const fromHome = await resolveResumeTarget(
    store.getCard(ref.cardId)!,
    sessionOf(ref),
  );
  assert.equal(sessionIdOf(fromHome), "home-conv");

  await store.setSessionAccount(ref.cardId, ref.sessionId, ACCOUNT);
  const fromAdded = await resolveResumeTarget(
    store.getCard(ref.cardId)!,
    sessionOf(ref),
  );
  assert.equal(sessionIdOf(fromAdded), "added-conv");
});

void test("recordNewestConversation records a newer file and ignores an older one", async () => {
  const ref = await card("record");
  const dir = projectsDirOf(path.join(env.home, ".claude"), ref.cwd);
  touch(dir, "older");
  await pause();
  await store.setClaudeSessionId(ref.cardId, ref.sessionId, "stored");

  await recordNewestConversation(ref.cardId, ref.sessionId);
  assert.equal(store.getCard(ref.cardId)?.claudeSessionId, "stored");

  await pause();
  touch(dir, "newer");
  await recordNewestConversation(ref.cardId, ref.sessionId);
  assert.equal(store.getCard(ref.cardId)?.claudeSessionId, "newer");
  assert.deepEqual(
    sessionOf(ref).claudeSessions?.map((n) => n.id),
    ["stored", "newer"],
  );
});

void test("a conversation Claude refused is left out of the next choice and stays missing", async () => {
  const ref = await card("refused");
  const dir = projectsDirOf(path.join(env.home, ".claude"), ref.cwd);
  const now = Date.now();
  await store.startClaudeSession(
    ref.cardId,
    ref.sessionId,
    "a",
    new Date(now - 60_000).toISOString(),
  );
  await store.startClaudeSession(
    ref.cardId,
    ref.sessionId,
    "b",
    new Date(now - 30_000).toISOString(),
  );
  await store.markClaudeSessionMissing(ref.cardId, ref.sessionId, "b");
  touch(dir, "a");
  await pause();
  touch(dir, "b");

  const target = await resolveResumeTarget(
    store.getCard(ref.cardId)!,
    sessionOf(ref),
  );
  assert.equal(sessionIdOf(target), "a");

  await recordNewestConversation(ref.cardId, ref.sessionId);
  const nodes = sessionOf(ref).claudeSessions;
  assert.notEqual(nodes?.find((n) => n.id === "b")?.missingAt, undefined);
  assert.equal(store.getCard(ref.cardId)?.claudeSessionId, "a");
});

void test.after(() => env.cleanup());
