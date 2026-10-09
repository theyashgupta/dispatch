import assert from "node:assert/strict";
import { test } from "node:test";
import type { AttentionItem } from "../../../../shared/attention-queue.js";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import type { Card, ClaudeAccountSummary } from "../../../../shared/types.js";
import {
  attentionRows,
  replyResultText,
  waitingText,
  type AttentionContext,
  type AttentionRow,
} from "./attention-rows.js";

function item(
  kind: AttentionItem["kind"],
  extra: Partial<AttentionItem> = {},
): AttentionItem {
  return {
    id: `${kind}:c1`,
    kind,
    cardId: "c1",
    groupId: "GROUP-1",
    state: null,
    waitingSince: "2026-10-07T11:26:00Z",
    waitMinutes: 34,
    text: null,
    reply: false,
    ...extra,
  };
}

const ACCOUNT = {
  id: "a1",
  isDefault: false,
  limitedUntil: null,
  buckets: [
    { kind: "five_hour", percent: 100, resetsAt: "2026-10-07T05:30:00Z" },
  ],
} as unknown as ClaudeAccountSummary;

const CARD = {
  id: "c1",
  identifier: "GROUP-1",
  activeSessionId: "s1",
  sessions: [{ id: "s1", claudeAccountId: "a1" }],
} as unknown as Card;

const CTX: AttentionContext = {
  boardKey: DEFAULT_BOARD_KEY,
  cards: [CARD],
  accounts: [ACCOUNT],
  groups: [{ cardId: "c1", cost: 20, budget: 20 }],
  decisions: [],
  timeZone: "UTC",
};

type ItemRow = Extract<AttentionRow, { type: "item" }>;

function only(rows: AttentionRow[]): ItemRow | undefined {
  const [row] = rows;
  return row?.type === "item" ? row : undefined;
}

function body(kind: AttentionItem["kind"], extra: Partial<AttentionItem> = {}) {
  return only(attentionRows([item(kind, extra)], CTX));
}

test("an item row shows the wait, the state badge and the body", () => {
  const row = body("stale", {
    text: "No progress for 34 min.",
    state: "stale",
  });
  assert.equal(row?.waiting, "waiting 34 min");
  assert.equal(row?.cardId, "c1");
  assert.deepEqual(row?.badge, { kind: "state", state: "stale" });
  assert.equal(row?.body, "No progress for 34 min.");
  assert.equal(row?.action, null);
});

test("needs input and permission prompt items become reply rows titled by group", () => {
  const rows = attentionRows(
    [
      item("needs_input", {
        text: "Which branch?",
        state: "needs_input",
        reply: true,
      }),
      item("permission_prompt", { id: "permission_prompt:c1", text: "Allow?" }),
    ],
    CTX,
  );
  assert.deepEqual(
    rows.map((r) => (r.type === "reply" ? [r.kind, r.title, r.text] : r.type)),
    [
      ["needs_input", "GROUP-1", "Which branch?"],
      ["permission_prompt", "GROUP-1", "Allow?"],
    ],
  );
});

test("a stale item with a reply gets the reply row and a needs input item with no session stays an item row", () => {
  const [stale, bare] = attentionRows(
    [
      item("stale", {
        text: "No progress for 40 min.",
        state: "stale",
        reply: true,
      }),
      item("needs_input", { id: "needs_input:c2", cardId: "c2", reply: false }),
    ],
    CTX,
  );
  assert.equal(stale?.type, "reply");
  assert.equal(stale?.type === "reply" ? stale.kind : null, "stale");
  assert.equal(
    stale?.type === "reply" ? stale.text : null,
    "No progress for 40 min.",
  );
  assert.equal(bare?.type, "item");
});

test("a decision item becomes a decision row with its view, and falls back when the view is gone", () => {
  const view = {
    id: "d1",
    question: "Retry?",
    meta: "Board, asked by Main 1 min ago",
    options: [],
    proposalTitles: [],
    otherOptionId: null,
  };
  const decision = item("decision", {
    id: "decision:d1",
    cardId: null,
    groupId: null,
    text: "Retry?",
  });
  const [row] = attentionRows([decision], { ...CTX, decisions: [view] });
  assert.equal(row?.type === "decision" ? row.view : null, view);
  const fallback = only(attentionRows([decision], CTX));
  assert.deepEqual(fallback?.badge, { kind: "label", label: "Decision" });
  assert.equal(fallback?.cardId, null);
  assert.equal(fallback?.body, "Retry?");
});

test("stops offer Resume loop, a failed resume offers Try resume again, a budget stop links Change budget", () => {
  assert.equal(body("usage_stop")?.action, "resume");
  assert.equal(body("budget_stop")?.action, "resume");
  assert.equal(body("resume_failed")?.action, "retry_resume");
  assert.equal(body("failed_gate")?.action, null);
  assert.equal(
    body("budget_stop")?.changeBudgetHref,
    "#/board?panel=orchestrator&tab=policy",
  );
  assert.equal(body("usage_stop")?.changeBudgetHref, null);
});

test("a usage stop reads the reset time of the account and drops it when unknown", () => {
  assert.equal(
    body("usage_stop", { state: "needs_input" })?.body,
    "Stopped at the usage limit. The limit resets at 05:30.",
  );
  assert.equal(
    only(attentionRows([item("usage_stop")], { ...CTX, accounts: [] }))?.body,
    "Stopped at the usage limit.",
  );
});

test("a budget stop reads cost and budget of the group", () => {
  assert.equal(body("budget_stop")?.body, "Budget reached: $20.00 of $20.00.");
  assert.equal(
    only(attentionRows([item("budget_stop")], { ...CTX, groups: [] }))?.body,
    "Budget reached.",
  );
});

test("a failed gate has the neutral label and the attempt copy", () => {
  const gate = { unit: 1, phase: 7, attempt: 1, limit: 2 };
  const row = body("failed_gate", { gate });
  assert.deepEqual(row?.badge, { kind: "label", label: "Failed gate" });
  assert.equal(row?.body, "Phase 7 gate failed, attempt 1 of 2.");
  assert.equal(
    body("failed_gate", { gate: { ...gate, limit: null } })?.body,
    "Phase 7 gate failed, attempt 1.",
  );
});

test("a failed resume uses the lost copy or the exited copy", () => {
  assert.equal(
    body("resume_failed", { text: "no tmux", lost: true })?.body,
    "The session was lost and the resume failed: no tmux.",
  );
  assert.equal(
    body("resume_failed", { text: "no tmux" })?.body,
    "Claude exited and the resume failed: no tmux.",
  );
});

test("a usage stop reads the account of a wire-shape card", () => {
  const wire = {
    id: "c1",
    identifier: "GROUP-1",
    activeSessionId: "s1",
    claudeAccountId: "a1",
    sessionSummaries: [
      { id: "s1", active: true, createdAt: "", updatedAt: "" },
    ],
  } as unknown as Card;
  assert.equal(
    only(
      attentionRows([item("usage_stop", { state: "needs_input" })], {
        ...CTX,
        cards: [wire],
      }),
    )?.body,
    "Stopped at the usage limit. The limit resets at 05:30.",
  );
});

test("a reply result reads Delivered, Not confirmed, or Not sent with the new state", () => {
  assert.equal(
    replyResultText(
      { ok: true, result: "confirmed" },
      "GROUP-1",
      "needs_input",
    ),
    "Delivered",
  );
  assert.equal(
    replyResultText({ ok: true, result: "unconfirmed" }, "GROUP-1", undefined),
    "Not confirmed. Check the terminal.",
  );
  assert.equal(
    replyResultText(
      {
        ok: false,
        error: "session-state-refused",
        reason: "session is at shell_prompt",
      },
      "GROUP-1",
      "shell_prompt",
    ),
    "Not sent. GROUP-1 is now at Claude exited. Open the terminal.",
  );
  assert.equal(
    replyResultText(
      { ok: false, error: "no-live-session", reason: null },
      "GROUP-1",
      "needs_input",
    ),
    null,
  );
});

test("waitingText uses minutes under 60, hours under 48, then days", () => {
  assert.equal(waitingText(0), "waiting 0 min");
  assert.equal(waitingText(59), "waiting 59 min");
  assert.equal(waitingText(60), "waiting 1 h");
  assert.equal(waitingText(47 * 60 + 59), "waiting 47 h");
  assert.equal(waitingText(48 * 60), "waiting 2 d");
  assert.equal(waitingText(576002), "waiting 400 d");
});
