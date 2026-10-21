import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import type { Card } from "../../../../shared/types.js";
import { liveResumeFailure } from "./live-resume-failure.js";

function card(extra: Partial<Card>): Card {
  return {
    id: "c1",
    boardKey: DEFAULT_BOARD_KEY,
    issueId: "c1",
    identifier: "LOCAL-1",
    title: "A card",
    description: null,
    priority: 0,
    column: "in_progress",
    updatedAt: "2026-10-14T00:00:00.000Z",
    ...extra,
  };
}

const refused: Partial<Card> = {
  tmuxSession: "dsp-x",
  state: "needs_input",
  stateReason: "resume_failed",
  statusReason: "resume: Resume failed: workspace-missing: /w/x",
  column: "needs_input",
};

test("a live session refused with resume_failed shows the reason without the resume lead", () => {
  assert.equal(
    liveResumeFailure(card(refused)),
    "Resume failed: workspace-missing: /w/x",
  );
});

test("a lost session, a card with no tmux session, another state, another reason or an empty reason shows no alert", () => {
  const variants: Partial<Card>[] = [
    { sessionLost: true },
    { tmuxSession: undefined },
    { state: "working" },
    { stateReason: "supervisor_gave_up" },
    { statusReason: undefined },
    { statusReason: "resume: " },
  ];
  for (const variant of variants) {
    assert.equal(liveResumeFailure(card({ ...refused, ...variant })), null);
  }
});
