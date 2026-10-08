import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

const env = isolateEnv();
const { store, redactCard } = await import("../../store/board.store.js");
const { applyHookEvent } = await import("./hook-events.js");
const { setHooksRuntime } = await import("../infra/config-holder.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });
await store.load();
after(() => env.cleanup());

async function cardWithSession(title: string) {
  const created = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: `/tmp/ws-${title}`,
    tmuxSession: `dsp-${title}`,
    branch: title,
  });
  const card = store.getCard(created.id)!;
  return { cardId: card.id, sessionId: card.activeSessionId! };
}

const transcriptOf = (cardId: string, sessionId: string) =>
  store.getCard(cardId)?.sessions?.find((s) => s.id === sessionId)
    ?.transcriptPath;

const VALID = "/Users/someone/.claude/projects/-ws-a/conv-1.jsonl";

void test("a valid hook transcript_path is stored on the session and reaches the wire", async () => {
  const { cardId, sessionId } = await cardWithSession("transcript-ok");
  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "Unknown",
    transcript_path: VALID,
  });
  assert.equal(transcriptOf(cardId, sessionId), VALID);
  const wire = redactCard(store.getCard(cardId)!);
  assert.equal(wire.transcriptPath, VALID);
  assert.equal(wire.sessionSummaries?.[0]?.transcriptPath, VALID);
});

void test("a relative, non-jsonl or out of projects transcript_path is refused", async () => {
  const { cardId, sessionId } = await cardWithSession("transcript-bad");
  for (const bad of [
    "projects/-ws-a/conv-1.jsonl",
    "/Users/someone/.claude/projects/-ws-a/conv-1.json",
    "/tmp/elsewhere/conv-1.jsonl",
    "/Users/someone/.claude/projects/-ws-a/../../../../etc/x.jsonl",
    42,
  ]) {
    await applyHookEvent(cardId, sessionId, {
      hook_event_name: "Unknown",
      transcript_path: bad,
    });
  }
  assert.equal(transcriptOf(cardId, sessionId), undefined);
});
