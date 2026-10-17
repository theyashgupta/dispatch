import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card, OrchestratorRecord } from "../../../../shared/types.js";
import { assignableCard, orchestratorOptions } from "./orchestrator-field.js";

function card(extra: Partial<Card>): Card {
  return {
    id: "c",
    identifier: "LOCAL-1",
    title: "t",
    column: "todo",
    ...extra,
  } as Card;
}

function record(
  id: string,
  role: "main" | "extra",
  ticketIds: string[] = [],
): OrchestratorRecord {
  return {
    id,
    name: id.toUpperCase(),
    role,
    scope: { groupIds: [], ticketIds },
    policyOverride: {},
    cardId: null,
    state: "stopped",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const main = record("lead", "main");
const feat = record("feat", "extra", ["c"]);

test("orchestratorOptions labels each record with its kind", () => {
  assert.deepEqual(orchestratorOptions([main, feat]), [
    { id: "lead", label: "LEAD (Board)" },
    { id: "feat", label: "FEAT (Feature)" },
  ]);
  assert.deepEqual(
    orchestratorOptions([{ ...record("x", "extra"), kind: "board" }]),
    [{ id: "x", label: "X (Board)" }],
  );
});

test("assignableCard needs an extra, an open card and a card that is not a group member", () => {
  assert.equal(assignableCard(card({}), [main, feat]), true);
  assert.equal(assignableCard(card({}), [main]), false);
  assert.equal(assignableCard(card({ column: "done" }), [main, feat]), false);
  assert.equal(assignableCard(card({ groupId: "g" }), [main, feat]), false);
  assert.equal(
    assignableCard(card({ source: "group", groupId: "g" }), [main, feat]),
    true,
  );
  assert.equal(
    assignableCard(card({ source: "orchestrator" }), [main, feat]),
    false,
  );
});
