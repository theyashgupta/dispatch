import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActivityEvent, EventType } from "../../../../shared/types.js";
import { activityFilterOptions } from "./activity-filter-options.js";

function event(
  id: number,
  type: EventType,
  cardId: string | null,
): ActivityEvent {
  return {
    id,
    cardId,
    type,
    fromCol: null,
    toCol: null,
    reason: null,
    source: null,
    ts: "2026-09-24T09:00:00.000Z",
  };
}

const none = { cardId: null, types: [] };

test("dedupes cards, skips null cards and labels with identifiers", () => {
  const { cardOptions } = activityFilterOptions(
    [
      event(1, "sync_in", "a"),
      event(2, "sync_in", "a"),
      event(3, "cleanup", null),
      event(4, "cleanup", "b"),
    ],
    none,
    { a: "LOCAL-1" },
  );
  assert.deepEqual(cardOptions, [
    { id: "a", label: "LOCAL-1" },
    { id: "b", label: "b" },
  ]);
});

test("keeps a selected card and selected types that no event carries", () => {
  const { cardOptions, typeOptions } = activityFilterOptions(
    [event(1, "sync_in", "a")],
    { cardId: "gone", types: ["session_lost"] },
    {},
  );
  assert.deepEqual(
    cardOptions.map((o) => o.id),
    ["a", "gone"],
  );
  assert.deepEqual(typeOptions, [
    { id: "sync_in", label: "sync in" },
    { id: "session_lost", label: "session lost" },
  ]);
});

test("returns empty lists for an empty feed", () => {
  assert.deepEqual(activityFilterOptions([], none, {}), {
    cardOptions: [],
    typeOptions: [],
  });
});
