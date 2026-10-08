import test from "node:test";
import assert from "node:assert/strict";
import {
  forgetTurnState,
  onLimitSignal,
  paneTurnState,
  recordTurnEvent,
  recordedTurnState,
  resolveTurnState,
  turnStateOf,
} from "./session-turn.js";
import { setHooksRuntime } from "../infra/config-holder.js";

const IDLE_PANE = "> \n? for shortcuts";
const BUSY_PANE = "* Working... (esc to interrupt)";
const LIMIT_A =
  "Usage limit reached · continuing automatically at 10:40am · esc to cancel";
const LIMIT_A_SHORT = "Continuing automatically at 10:40am · esc to cancel";
const LIMIT_B = [
  "What do you want to do?",
  " ❯ 1. Switch to usage credits",
  "   2. Stop and wait for limit to reset",
].join("\n");
const LIMIT_B_WAIT_ONLY =
  " ❯ 1. Wait here, then continue automatically at 10:40am\n   2. Upgrade your plan";

void test("each hook event sets its state and other events change nothing", () => {
  const cases: [unknown, unknown, string][] = [
    ["UserPromptSubmit", undefined, "busy"],
    ["Stop", undefined, "idle"],
    ["StopFailure", "rate_limit", "limit"],
    ["StopFailure", "server_error", "idle"],
  ];
  for (const [event, error, expected] of cases) {
    const before = event === "UserPromptSubmit" ? "Stop" : "UserPromptSubmit";
    recordTurnEvent("c1", "s1", before, undefined);
    recordTurnEvent("c1", "s1", event, error);
    assert.equal(recordedTurnState("c1", "s1"), expected, String(event));
  }
  recordTurnEvent("c1", "s1", "PostToolUse", undefined);
  recordTurnEvent("c1", "s1", "PreToolUse", undefined);
  assert.equal(recordedTurnState("c1", "s1"), "idle");
  assert.equal(recordedTurnState("c1", "s2"), "unknown", "per session");
});

void test("a session with no event since boot is unknown, and a reaped one reads unknown again", () => {
  assert.equal(recordedTurnState("fresh", "s"), "unknown");
  recordTurnEvent("fresh", "s", "Stop", undefined);
  forgetTurnState("fresh", "s");
  assert.equal(recordedTurnState("fresh", "s"), "unknown");
});

void test("the pane check reads busy, both limit surfaces, and idle", () => {
  assert.equal(paneTurnState(BUSY_PANE), "busy");
  assert.equal(paneTurnState(LIMIT_A), "limit");
  assert.equal(paneTurnState(LIMIT_A_SHORT), "limit");
  assert.equal(paneTurnState(LIMIT_B), "limit");
  assert.equal(paneTurnState(LIMIT_B_WAIT_ONLY), "limit");
  assert.equal(paneTurnState(IDLE_PANE), "idle");
  assert.equal(
    paneTurnState("continuing automatically"),
    "idle",
    "surface (a) needs both parts",
  );
});

void test("resolveTurnState truth table", () => {
  const rows: [string, string, boolean, string][] = [
    ["unknown", IDLE_PANE, false, "idle"],
    ["unknown", BUSY_PANE, false, "busy"],
    ["unknown", LIMIT_A, false, "limit"],
    ["idle", IDLE_PANE, false, "idle"],
    ["idle", BUSY_PANE, false, "busy"],
    ["idle", LIMIT_B, false, "limit"],
    ["busy", IDLE_PANE, false, "busy"],
    ["limit", IDLE_PANE, false, "limit"],
    ["busy", IDLE_PANE, true, "idle"],
    ["limit", IDLE_PANE, true, "idle"],
    ["idle", BUSY_PANE, true, "busy"],
    ["idle", LIMIT_A, true, "limit"],
  ];
  for (const [hook, pane, paneOnly, expected] of rows) {
    assert.equal(
      resolveTurnState(hook as never, pane, paneOnly),
      expected,
      `${hook} / ${pane.slice(0, 20)} / paneOnly=${paneOnly}`,
    );
  }
});

void test("turnStateOf ignores the hook state in pane channel mode", () => {
  recordTurnEvent("c9", "s9", "UserPromptSubmit", undefined);
  setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });
  assert.equal(turnStateOf("c9", "s9", IDLE_PANE), "busy");
  setHooksRuntime({ capable: true, port: 1, statusChannel: "pane" });
  assert.equal(turnStateOf("c9", "s9", IDLE_PANE), "idle");
  assert.equal(turnStateOf("c9", "s9", BUSY_PANE), "busy");
  setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });
});

void test("a pane signals a limit once when it enters a surface, again only after it leaves, and never from a hook limit on an idle pane (U2-07)", () => {
  const signals: (string | null)[] = [];
  onLimitSignal((cardId, _sessionId, pane) => {
    if (cardId === "sig") signals.push(pane);
  });
  setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });
  recordTurnEvent("sig", "s", "StopFailure", "rate_limit");
  assert.deepEqual(signals, [null]);
  assert.equal(turnStateOf("sig", "s", IDLE_PANE), "limit");
  assert.equal(turnStateOf("sig", "s", IDLE_PANE), "limit");
  assert.deepEqual(signals, [null], "hook limit on an idle pane");
  turnStateOf("sig", "s", `${LIMIT_A}\n${BUSY_PANE}`);
  assert.deepEqual(signals, [null], "busy pane with surface text");
  turnStateOf("sig", "s", LIMIT_A);
  turnStateOf("sig", "s", LIMIT_A);
  assert.deepEqual(signals, [null, LIMIT_A], "one signal per entry");
  turnStateOf("sig", "s", IDLE_PANE);
  turnStateOf("sig", "s", LIMIT_B);
  assert.deepEqual(signals, [null, LIMIT_A, LIMIT_B]);
});
