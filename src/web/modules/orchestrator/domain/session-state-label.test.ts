import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SESSION_STATE_LABELS,
  sessionStateLabel,
  stateBadgeProps,
  type StateTone,
} from "./session-state-label.js";

test("the twelve states map to the contract label, glyph and tone", () => {
  const table: Record<string, [string, string, StateTone]> = {
    working: ["Working", "Play", "neutral"],
    idle: ["Idle", "Pause", "muted"],
    needs_input: ["Needs input", "MessageCircleQuestionMark", "attention"],
    permission_prompt: ["Permission prompt", "ShieldQuestionMark", "attention"],
    handoff_ready: ["Handing off", "ArrowRightLeft", "neutral"],
    roadmap_complete: ["Roadmap done", "CircleCheck", "success"],
    usage_limit_dialog: ["Usage limit dialog", "Gauge", "attention"],
    usage_limit_wait: ["Waiting for usage reset", "Hourglass", "muted"],
    api_error: ["API error", "TriangleAlert", "error"],
    stale: ["No progress", "Clock", "attention"],
    lost: ["Session lost", "Unplug", "error"],
    shell_prompt: ["Claude exited", "SquareTerminal", "error"],
  };
  assert.equal(Object.keys(SESSION_STATE_LABELS).length, 12);
  for (const [state, [label, glyph, tone]] of Object.entries(table)) {
    assert.deepEqual(sessionStateLabel(state), { label, glyph, tone });
  }
});

test("a missing or unknown state has no label", () => {
  assert.equal(sessionStateLabel(null), null);
  assert.equal(sessionStateLabel("toString"), null);
  assert.equal(sessionStateLabel("bogus"), null);
});

test("each tone maps to its badge props and none uses the accent tone", () => {
  assert.deepEqual(stateBadgeProps("attention"), {
    tone: "state",
    stateColor: "var(--col-needs-input)",
  });
  assert.deepEqual(stateBadgeProps("error"), { tone: "danger" });
  assert.deepEqual(stateBadgeProps("success"), { tone: "success" });
  assert.deepEqual(stateBadgeProps("muted"), { tone: "neutral" });
  assert.deepEqual(stateBadgeProps("neutral"), { variant: "outline" });
});
