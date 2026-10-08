import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Card,
  ShipBranch,
  ShipBranchState,
  ShipFlow,
} from "../../../../shared/types.js";
import { shipBlocks } from "./ship-rows.js";

const HASH = "#";

function branch(name: string, extra: Partial<ShipBranch> = {}): ShipBranch {
  return {
    name,
    title: name,
    body: "",
    state: "queued",
    pr: null,
    checks: null,
    identity: null,
    admin: false,
    tip: null,
    checked: null,
    ...extra,
  };
}

function flow(startedAt: string, extra: Partial<ShipFlow> = {}): ShipFlow {
  return {
    state: "running",
    rights: "merge",
    repository: "o/r",
    repo: null,
    orchestratorId: "o",
    identity: { name: "n", email: "e" },
    branches: [],
    failedStep: null,
    reason: null,
    decisionId: null,
    startedAt,
    finishedAt: null,
    ...extra,
  };
}

function card(identifier: string, shipFlow?: ShipFlow): Card {
  return {
    id: `id-${identifier}`,
    identifier,
    ...(shipFlow === undefined ? {} : { shipFlow }),
  } as Card;
}

test("blocks follow the flow start order and skip cards without a flow", () => {
  const blocks = shipBlocks([
    card("GROUP-2", flow("2026-10-07T12:00:00Z")),
    card("GROUP-3"),
    card("GROUP-1", flow("2026-10-07T09:00:00Z")),
  ]);
  assert.deepEqual(
    blocks.map((b) => b.groupId),
    ["GROUP-1", "GROUP-2"],
  );
});

test("a running flow with mixed branches maps labels, glyphs and tones", () => {
  const [block] = shipBlocks([
    card(
      "GROUP-1",
      flow("2026-10-07T09:00:00Z", {
        branches: [
          branch("a", {
            state: "merged",
            pr: 177,
            checks: "passed",
            identity: "passed",
          }),
          branch("b", {
            state: "waiting_checks",
            pr: 178,
            checks: "pending",
          }),
          branch("c"),
        ],
      }),
    ),
  ]);
  assert.deepEqual(block?.flow, { label: "Running", glyph: "Play" });
  assert.equal(block?.failed, null);
  const [a, b, c] = block?.branches ?? [];
  assert.equal(a?.order, 1);
  assert.equal(a?.pr, `${HASH}177`);
  assert.deepEqual(a?.state, {
    label: "Merged",
    glyph: "CircleCheck",
    tone: "success",
  });
  assert.deepEqual(a?.checks, {
    label: "Passing",
    glyph: "Check",
    tone: "success",
  });
  assert.deepEqual(a?.identity, {
    label: "Author verified",
    glyph: "ShieldCheck",
    tone: "neutral",
  });
  assert.deepEqual(b?.state, {
    label: "Waiting for checks",
    glyph: "LoaderCircle",
    tone: "neutral",
  });
  assert.equal(b?.checks.label, "Pending");
  assert.equal(c?.pr, "-");
  assert.equal(c?.checks.label, "Not started");
  assert.equal(c?.identity.label, "Not checked yet");
  assert.equal(c?.identity.glyph, "CircleMinus");
});

test("a stopped flow names the failed step and reason, and failures are danger", () => {
  const [block] = shipBlocks([
    card(
      "GROUP-1",
      flow("2026-10-07T09:00:00Z", {
        state: "stopped",
        failedStep: "verifying" satisfies ShipBranchState,
        reason: "author mismatch",
        branches: [
          branch("a", {
            state: "failed",
            checks: "failed",
            identity: "failed",
          }),
        ],
      }),
    ),
  ]);
  assert.equal(block?.failed, "Stopped at Verifying: author mismatch");
  assert.equal(block?.flow.glyph, "CircleStop");
  const row = block?.branches[0];
  assert.equal(row?.state.tone, "danger");
  assert.equal(row?.checks.tone, "danger");
  assert.equal(row?.identity.label, "Author mismatch");
  assert.equal(row?.identity.tone, "danger");
});
