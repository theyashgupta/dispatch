import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { applyHookEvent } = await import("./hook-events.js");
const { setHooksRuntime } = await import("../infra/config-holder.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });

async function cardWithSession(title: string) {
  await store.load();
  const created = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
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

void test("a session_id that starts with a dash is not stored, so it cannot become a CLI flag", async () => {
  const { cardId, sessionId } = await cardWithSession("hook-dash");
  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "Unknown",
    session_id: "conv-safe",
  });
  for (const bad of ["--dangerously-skip-permissions", "-x", "-"]) {
    await applyHookEvent(cardId, sessionId, {
      hook_event_name: "Unknown",
      session_id: bad,
    });
  }
  assert.equal(store.getCard(cardId)?.claudeSessionId, "conv-safe");
  assert.equal(nodesOf(cardId, sessionId)?.length, 1);
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

void test("a Stop hook with a DONE marker leaves a parked card parked and records the marker", async () => {
  const { cardId, sessionId } = await cardWithSession("hook-parked-stop");
  await store.moveCardManual(cardId, "parked");
  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "Stop",
    session_id: "conv-parked",
    last_assistant_message:
      "all wrapped up\nDISPATCH_STATUS: DONE - shipped it",
  });
  const card = store.getCard(cardId)!;
  assert.equal(card.column, "parked");
  assert.ok(card.lastMarker, "marker consumed, key recorded");
  assert.ok(
    store
      .listEvents(DEFAULT_BOARD_KEY, cardId, 50)
      .every((e) => e.type !== "status_agent_done"),
    "no status event while parked",
  );
});

void test("a UserPromptSubmit hook moves a parked card to in_progress", async () => {
  const { cardId, sessionId } = await cardWithSession("hook-parked-prompt");
  await store.moveCardManual(cardId, "parked");
  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "UserPromptSubmit",
    session_id: "conv-parked-prompt",
  });
  assert.equal(store.getCard(cardId)?.column, "in_progress");
});

void test("UserPromptSubmit, Stop and StopFailure set the turn state; the pane channel records none", async () => {
  const { recordedTurnState } = await import("./session-turn.js");
  const { cardId, sessionId } = await cardWithSession("hook-turn");
  try {
    assert.equal(recordedTurnState(cardId, sessionId), "unknown");
    await applyHookEvent(cardId, sessionId, {
      hook_event_name: "UserPromptSubmit",
    });
    assert.equal(recordedTurnState(cardId, sessionId), "busy");
    await applyHookEvent(cardId, sessionId, {
      hook_event_name: "Stop",
      last_assistant_message: "done",
    });
    assert.equal(recordedTurnState(cardId, sessionId), "idle");
    await applyHookEvent(cardId, sessionId, {
      hook_event_name: "StopFailure",
      error: "rate_limit",
    });
    assert.equal(recordedTurnState(cardId, sessionId), "limit");

    setHooksRuntime({ capable: true, port: 1, statusChannel: "pane" });
    await applyHookEvent(cardId, sessionId, {
      hook_event_name: "UserPromptSubmit",
    });
    assert.equal(recordedTurnState(cardId, sessionId), "limit");
  } finally {
    setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });
  }
});

const columnOf = (cardId: string) => store.getCard(cardId)?.column;

void test("a subagent AskUserQuestion leaves the card in progress", async () => {
  const { cardId, sessionId } = await cardWithSession("hook-subagent-pause");
  assert.equal(columnOf(cardId), "in_progress");
  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "PreToolUse",
    tool_name: "AskUserQuestion",
    tool_use_id: "toolu_subagent",
    agent_id: "a0473ff8813982962",
    agent_type: "review-edge-cases",
  } as Parameters<typeof applyHookEvent>[2]);
  assert.equal(columnOf(cardId), "in_progress");
  assert.equal(store.getCard(cardId)?.lastMarker, undefined);
});

void test("a main-session AskUserQuestion that fails flips the card back", async () => {
  const { cardId, sessionId } = await cardWithSession("hook-pause-failure");
  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "PreToolUse",
    tool_name: "AskUserQuestion",
    tool_use_id: "toolu_failed",
  });
  assert.equal(columnOf(cardId), "needs_input");
  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "PostToolUseFailure",
    tool_name: "AskUserQuestion",
    tool_use_id: "toolu_failed",
    error: "no dialog",
  });
  assert.equal(columnOf(cardId), "in_progress");
});

void test("main-session output after a pause-tool marker flips the card back", async () => {
  for (const next of [
    { hook_event_name: "PostToolUse", tool_name: "Bash" },
    { hook_event_name: "Stop", last_assistant_message: "still working" },
  ]) {
    const { cardId, sessionId } = await cardWithSession(
      `hook-ran-on-${next.hook_event_name}`,
    );
    await applyHookEvent(cardId, sessionId, {
      hook_event_name: "PreToolUse",
      tool_name: "AskUserQuestion",
      tool_use_id: `toolu_${next.hook_event_name}`,
    });
    assert.equal(columnOf(cardId), "needs_input");
    await applyHookEvent(cardId, sessionId, {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      agent_id: "a-subagent",
    } as Parameters<typeof applyHookEvent>[2]);
    assert.equal(columnOf(cardId), "needs_input", "subagent output is ignored");
    await applyHookEvent(cardId, sessionId, next);
    assert.equal(columnOf(cardId), "in_progress", next.hook_event_name);
  }
});

void test("main-session output after a text NEEDS_INPUT marker keeps the card waiting", async () => {
  const { cardId, sessionId } = await cardWithSession("hook-text-pause");
  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "Stop",
    last_assistant_message: "DISPATCH_STATUS: NEEDS_INPUT - pick a name",
  });
  assert.equal(columnOf(cardId), "needs_input");
  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
  });
  assert.equal(columnOf(cardId), "needs_input");
});
