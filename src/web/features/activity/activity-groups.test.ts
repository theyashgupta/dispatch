import { test } from "node:test";
import assert from "node:assert/strict";
import type { ActivityEvent, EventType } from "../../../shared/types.js";
import { filterEvents, groupEventsByDay } from "./activity-groups.js";

let seq = 0;
function event(
  ts: string,
  type: EventType = "local_created",
  cardId: string | null = "LOCAL-1",
): ActivityEvent {
  seq += 1;
  return {
    id: seq,
    cardId,
    type,
    fromCol: null,
    toCol: null,
    reason: null,
    source: null,
    ts,
  };
}

function localIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

const NOW = new Date(2026, 8, 24, 12, 0).getTime();

test("labels today, yesterday and an older date", () => {
  const groups = groupEventsByDay(
    [
      event(localIso(2026, 9, 24, 9, 0)),
      event(localIso(2026, 9, 23, 22, 0)),
      event(localIso(2026, 9, 1, 8, 0)),
    ],
    NOW,
  );
  assert.deepEqual(
    groups.map((g) => [g.label, g.events.length]),
    [
      ["Today", 1],
      ["Yesterday", 1],
      [
        new Date(2026, 8, 1).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
        1,
      ],
    ],
  );
});

test("a local midnight boundary never shares a group", () => {
  const groups = groupEventsByDay(
    [event(localIso(2026, 9, 24, 0, 1)), event(localIso(2026, 9, 23, 23, 59))],
    NOW,
  );
  assert.equal(groups.length, 2);
  assert.notEqual(groups[0]?.dayKey, groups[1]?.dayKey);
});

test("empty input yields no groups", () => {
  assert.deepEqual(groupEventsByDay([], NOW), []);
});

test("filters by card only, type only and both", () => {
  const events = [
    event(localIso(2026, 9, 24, 9, 0), "local_created", "LOCAL-1"),
    event(localIso(2026, 9, 24, 9, 1), "move_manual", "LOCAL-1"),
    event(localIso(2026, 9, 24, 9, 2), "local_created", "LOCAL-2"),
  ];
  assert.equal(
    filterEvents(events, { cardId: "LOCAL-1", types: [] }).length,
    2,
  );
  assert.equal(
    filterEvents(events, { cardId: null, types: ["local_created"] }).length,
    2,
  );
  assert.equal(
    filterEvents(events, { cardId: "LOCAL-1", types: ["move_manual"] }).length,
    1,
  );
  assert.equal(filterEvents(events, { cardId: null, types: [] }).length, 3);
});

test("a type nobody emitted yields an empty set", () => {
  const events = [event(localIso(2026, 9, 24, 9, 0), "local_created")];
  assert.deepEqual(
    filterEvents(events, { cardId: null, types: ["cleanup"] }),
    [],
  );
});

test("yesterday steps back one calendar day across a short spring-forward day", () => {
  const noon = new Date(2026, 2, 9, 12, 0).getTime();
  const groups = groupEventsByDay(
    [event(localIso(2026, 3, 9, 9, 0)), event(localIso(2026, 3, 8, 0, 30))],
    noon,
  );
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Today", "Yesterday"],
  );
});
