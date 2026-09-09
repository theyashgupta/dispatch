import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { applyHookEvent } = await import("./hook-events.js");
const { setHooksRuntime } = await import("../infra/config-holder.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });

async function cardWithSession(title: string) {
  await store.load();
  const created = await store.createLocalCard(title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: `/tmp/ws-${title}`,
    tmuxSession: `dsp-${title}`,
    branch: title,
  });
  const card = store.getCard(created.id)!;
  return { cardId: card.id, sessionId: card.activeSessionId! };
}

const nodesOf = (cardId: string, sessionId: string) =>
  store.getCard(cardId)?.sessions?.find((s) => s.id === sessionId)
    ?.claudeSessions;

void test("applyHookEvent appends a node per distinct session_id and logs no mismatch", async () => {
  const { cardId, sessionId } = await cardWithSession("hook-nodes");
  const warn = mock.method(console, "warn", () => undefined);
  try {
    await applyHookEvent(cardId, sessionId, {
      hook_event_name: "Unknown",
      session_id: "conv-first",
    });
    assert.deepEqual(
      nodesOf(cardId, sessionId)?.map((n) => n.id),
      ["conv-first"],
    );
    assert.equal(store.getCard(cardId)?.claudeSessionId, "conv-first");

    await new Promise((r) => setTimeout(r, 2));
    await applyHookEvent(cardId, sessionId, {
      hook_event_name: "Unknown",
      session_id: "conv-after-clear",
    });
    assert.deepEqual(
      nodesOf(cardId, sessionId)?.map((n) => n.id),
      ["conv-first", "conv-after-clear"],
    );
    assert.equal(store.getCard(cardId)?.claudeSessionId, "conv-after-clear");

    await applyHookEvent(cardId, sessionId, {
      hook_event_name: "Unknown",
      session_id: "conv-after-clear",
    });
    assert.equal(
      nodesOf(cardId, sessionId)?.length,
      2,
      "known id, no new node",
    );
  } finally {
    warn.mock.restore();
  }
  assert.equal(
    warn.mock.calls.some((c) =>
      /mismatch/i.test(c.arguments.map(String).join(" ")),
    ),
    false,
  );
});

void test("applyHookEvent ignores a malformed session_id and an unresolvable session", async () => {
  const { cardId, sessionId } = await cardWithSession("hook-bad");
  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "Unknown",
    session_id: "bad id with spaces",
  });
  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "Unknown",
    session_id: "x".repeat(257),
  });
  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "Unknown",
    session_id: 42,
  });
  assert.equal(nodesOf(cardId, sessionId), undefined);
  assert.equal(store.getCard(cardId)?.claudeSessionId, undefined);

  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "Unknown",
    session_id: "y".repeat(256),
  });
  assert.equal(nodesOf(cardId, sessionId)?.length, 1, "256 chars is accepted");

  await applyHookEvent(cardId, "ghost-session", {
    hook_event_name: "Unknown",
    session_id: "conv-orphan",
  });
  assert.equal(nodesOf(cardId, sessionId)?.length, 1);
  assert.equal(
    store.getCard(cardId)?.sessions?.some((s) => s.id === "ghost-session"),
    false,
  );
});

void test("applyHookEvent on one session never touches a sibling session's nodes", async () => {
  const { cardId, sessionId } = await cardWithSession("hook-sibling");
  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "Unknown",
    session_id: "conv-primary",
  });
  const reserved = await store.reserveNewSession(
    cardId,
    store.getCard(cardId)!.identifier,
  );
  await applyHookEvent(cardId, reserved!.sessionId, {
    hook_event_name: "Unknown",
    session_id: "conv-second",
  });
  assert.deepEqual(
    nodesOf(cardId, sessionId)?.map((n) => n.id),
    ["conv-primary"],
  );
  assert.deepEqual(
    nodesOf(cardId, reserved!.sessionId)?.map((n) => n.id),
    ["conv-second"],
  );
  assert.equal(store.getCard(cardId)?.claudeSessionId, "conv-primary");
});
