import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";

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

void test("SessionStart ranks conversations by start: a late Stop of an older one keeps the newer, a resume start brings the older back", async () => {
  const { cardId, sessionId } = await cardWithSession("hook-start-order");
  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "SessionStart",
    session_id: "conv-a",
    source: "startup",
  });
  await new Promise((r) => setTimeout(r, 2));
  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "SessionStart",
    session_id: "conv-b",
    source: "clear",
  });
  await new Promise((r) => setTimeout(r, 2));
  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "Stop",
    session_id: "conv-a",
    last_assistant_message: "late",
  });
  assert.equal(store.getCard(cardId)?.claudeSessionId, "conv-b");
  assert.ok(nodesOf(cardId, sessionId)?.every((n) => n.startedAt != null));

  await new Promise((r) => setTimeout(r, 2));
  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "SessionStart",
    session_id: "conv-a",
    source: "resume",
  });
  assert.equal(store.getCard(cardId)?.claudeSessionId, "conv-a");
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
    await applyHookEvent(cardId, sessionId, {
      hook_event_name: "SessionStart",
      session_id: "conv-pane",
    });
    assert.equal(nodesOf(cardId, sessionId)?.length ?? 0, 0);
  } finally {
    setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });
  }
});

void test("the first SessionStart latches hook routing for its own session only, so the pane watcher yields at startup", async () => {
  const { cardId, sessionId } = await cardWithSession("hook-latch");
  const reserved = await store.reserveNewSession(
    cardId,
    store.getCard(cardId)!.identifier,
  );
  await store.mintHookChannel(
    cardId,
    "latch-token-primary-0123456789",
    sessionId,
  );
  await store.mintHookChannel(
    cardId,
    "latch-token-reserved-0123456789",
    reserved!.sessionId,
  );
  const latchOf = (id: string) =>
    store.getCard(cardId)?.sessions?.find((s) => s.id === id)?.hookRoutedAt;
  assert.equal(latchOf(sessionId), undefined);

  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "SessionStart",
    session_id: "conv-latch",
    source: "startup",
  });
  const stamped = latchOf(sessionId);
  assert.equal(typeof stamped, "string");
  assert.equal(latchOf(reserved!.sessionId), undefined);

  await applyHookEvent(cardId, sessionId, {
    hook_event_name: "Stop",
    session_id: "conv-latch",
  });
  assert.equal(latchOf(sessionId), stamped, "the latch is written once");
});

void test("a SessionStart under the pane channel latches nothing", async () => {
  const { cardId, sessionId } = await cardWithSession("hook-latch-pane");
  await store.mintHookChannel(cardId, "latch-token-pane-0123456789", sessionId);
  try {
    setHooksRuntime({ capable: true, port: 1, statusChannel: "pane" });
    await applyHookEvent(cardId, sessionId, {
      hook_event_name: "SessionStart",
      session_id: "conv-latch-pane",
      source: "startup",
    });
    assert.equal(
      store.getCard(cardId)?.sessions?.find((s) => s.id === sessionId)
        ?.hookRoutedAt,
      undefined,
    );
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
    });
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

const LOOP_BOARD = parseBoardKey("HKL") as BoardKey;
const SLUG = "hkl-174";
const DONE_TEXT = `All phases are green.\nDISPATCH_STATUS: DONE - ${SLUG} built`;
const PROMISE_DONE_TEXT = `All phases are green.\n<promise>RALPH COMPLETE ${SLUG}</promise>\nDISPATCH_STATUS: DONE - ${SLUG} built`;

async function loopBoard(supervisor: "on" | "off"): Promise<void> {
  await store.load();
  if (!store.getBoard(LOOP_BOARD)) {
    await store.createBoard({
      key: LOOP_BOARD,
      name: "Hook loop",
      workspaceRoot: "/hkl/sessions",
      repositories: [],
      linearTeamKeys: [],
    });
  }
  await store.setBoardPolicy(LOOP_BOARD, {
    ...store.getBoard(LOOP_BOARD)!.policy,
    supervisor,
  });
}

/** Seed a started card whose session root holds an open engine file and, with `phases`, a two phase PRD with that many GREEN phases. */
async function loopCardOn(
  title: string,
  opts: { supervisor?: "on" | "off"; phases: number | "none" },
) {
  await loopBoard(opts.supervisor ?? "on");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${title}-`));
  const engine = path.join(root, ".claude", "ralph-loop.local.md");
  const prd = path.join(root, "plan", ".planning", "prds", "demo.md");
  fs.mkdirSync(path.dirname(engine), { recursive: true });
  const head = `---\nactive: true\niteration: 1\nsession_id: sess-174\ncompletion_promise: "RALPH COMPLETE ${SLUG}"\n---\n`;
  if (opts.phases === "none") {
    fs.writeFileSync(engine, `${head}Keep going until the work is done.\n`);
  } else {
    const feature = path.join(root, "plan", ".planning", SLUG);
    fs.mkdirSync(path.dirname(prd), { recursive: true });
    fs.mkdirSync(feature, { recursive: true });
    fs.writeFileSync(
      engine,
      `${head}Execute the PRD at ${prd} per the ralph-loop skill.\n`,
    );
    fs.writeFileSync(
      prd,
      "# HKL 174\n\n### Phase 1: One\n\n### Phase 2: Two\n",
    );
    fs.writeFileSync(
      path.join(feature, "state.md"),
      [
        "phase 1 One GREEN 2026-10-16T04:00:00Z gate=pass",
        "phase 2 Two GREEN 2026-10-16T05:00:00Z gate=pass",
      ]
        .slice(0, opts.phases)
        .join("\n") + "\n",
    );
  }
  const created = await store.createLocalCard(LOOP_BOARD, title, "");
  await store.setOrchestratorFields(created.id, {
    launch: { direction: "ship it" },
  });
  await store.completeStart(created.id, undefined, {
    workspacePath: root,
    tmuxSession: `dsp-${title}`,
    branch: title,
  });
  const card = store.getCard(created.id)!;
  return { cardId: card.id, sessionId: card.activeSessionId!, engine };
}

const closeRows = (cardId: string) =>
  store
    .listOrchestrationEvents(LOOP_BOARD, 0, 500)
    .filter((e) => e.cardId === cardId && e.kind === "supervisor_action");

const stop = (cardId: string, sessionId: string, message: string) =>
  applyHookEvent(cardId, sessionId, {
    hook_event_name: "Stop",
    last_assistant_message: message,
  });

void test("a Stop DONE marker closes the engine file of a complete loop with done_marker", async () => {
  const { cardId, sessionId, engine } = await loopCardOn("hook-close", {
    phases: 2,
  });
  await stop(cardId, sessionId, DONE_TEXT);
  assert.equal(fs.existsSync(engine), false);
  assert.match(
    fs.readFileSync(`${engine}.done`, "utf8"),
    /^closed_reason: done_marker$/m,
  );
  assert.equal(closeRows(cardId).length, 1);
  assert.equal(closeRows(cardId)[0].data.action, "close_loop");
  assert.equal(closeRows(cardId)[0].data.result, "closed");
  assert.equal(store.getCard(cardId)?.loopProgress?.engine?.closed, true);
});

void test("a Stop DONE marker with the promise line closes a single PRD loop that has no phase model", async () => {
  const { cardId, sessionId, engine } = await loopCardOn("hook-no-phases", {
    phases: "none",
  });
  await stop(cardId, sessionId, PROMISE_DONE_TEXT);
  assert.equal(fs.existsSync(`${engine}.done`), true);
  assert.equal(closeRows(cardId).length, 1);
});

void test("a bare Stop DONE marker closes nothing on a loop with no phase model", async () => {
  const { cardId, sessionId, engine } = await loopCardOn(
    "hook-no-phases-bare",
    {
      phases: "none",
    },
  );
  await stop(cardId, sessionId, DONE_TEXT);
  assert.equal(fs.existsSync(engine), true);
  assert.equal(closeRows(cardId).length, 0);
});

void test("a Stop DONE marker closes nothing while phases are left", async () => {
  const { cardId, sessionId, engine } = await loopCardOn("hook-running", {
    phases: 1,
  });
  await stop(cardId, sessionId, DONE_TEXT);
  assert.equal(fs.existsSync(engine), true);
  assert.equal(closeRows(cardId).length, 0);
});

void test("a Stop DONE marker from a session that is not the active one closes nothing", async () => {
  const { cardId, sessionId, engine } = await loopCardOn("hook-other", {
    phases: 2,
  });
  await stop(cardId, `${sessionId}-other`, DONE_TEXT);
  assert.equal(fs.existsSync(engine), true);
  assert.equal(closeRows(cardId).length, 0);
});

void test("a Stop DONE marker on a board with the supervisor off closes nothing", async () => {
  const { cardId, sessionId, engine } = await loopCardOn("hook-off", {
    phases: 2,
    supervisor: "off",
  });
  await stop(cardId, sessionId, DONE_TEXT);
  assert.equal(fs.existsSync(engine), true);
  assert.equal(closeRows(cardId).length, 0);
});

void test("a Stop NEEDS_INPUT marker closes nothing", async () => {
  const { cardId, sessionId, engine } = await loopCardOn("hook-needs", {
    phases: 2,
  });
  await stop(cardId, sessionId, "DISPATCH_STATUS: NEEDS_INPUT - pick a name");
  assert.equal(fs.existsSync(engine), true);
  assert.equal(closeRows(cardId).length, 0);
});
