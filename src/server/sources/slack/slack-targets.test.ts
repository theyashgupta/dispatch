import assert from "node:assert/strict";
import { test } from "node:test";
import {
  historyOldest,
  nextCursorState,
  orderTargets,
  type CursorMap,
  type SlackTarget,
} from "./slack-targets.js";

const channel = (i: number): SlackTarget => ({
  id: `C${String(i).padStart(3, "0")}`,
  name: `c${i}`,
  conversation: "channel",
});
const dm = (i: number): SlackTarget => ({
  id: `D${String(i).padStart(3, "0")}`,
  name: "",
  conversation: "im",
});

test("3 channels and 10 DMs all fit, channels first", () => {
  const out = orderTargets(
    [1, 2, 3].map(channel),
    Array.from({ length: 10 }, (_, i) => dm(i)),
    {},
  );
  assert.equal(out.length, 13);
  assert.deepEqual(
    out.slice(0, 3).map((t) => t.id),
    ["C001", "C002", "C003"],
  );
});

test("45 channels and one DM give the 39 stalest channels and the DM; the next call starts with the channels left out", () => {
  const channels = Array.from({ length: 45 }, (_, i) => channel(i));
  const cursors: CursorMap = { D001: { polledAt: "2026-09-28T02:00:00.000Z" } };
  channels.forEach((c, i) => {
    cursors[c.id] = {
      polledAt: `2026-09-28T00:00:${String(59 - i).padStart(2, "0")}.000Z`,
    };
  });
  const first = orderTargets(channels, [dm(1)], cursors);
  assert.equal(first.length, 40);
  assert.equal(first.filter((t) => t.conversation === "channel").length, 39);
  assert.equal(first[0].id, "C044");
  assert.equal(first.at(-1)?.id, "D001");
  const polled: CursorMap = { ...cursors };
  for (const t of first)
    polled[t.id] = { polledAt: "2026-09-28T01:00:00.000Z" };
  const second = orderTargets(channels, [dm(1)], polled);
  assert.deepEqual(
    second
      .slice(0, 6)
      .map((t) => t.id)
      .sort(),
    ["C000", "C001", "C002", "C003", "C004", "C005"],
  );
});

test("45 channels and 12 DMs give 30 channels and 10 DMs; the next call reads the ones left out", () => {
  const channels = Array.from({ length: 45 }, (_, i) => channel(i));
  const dms = Array.from({ length: 12 }, (_, i) => dm(i));
  const first = orderTargets(channels, dms, {});
  assert.equal(first.length, 40);
  assert.equal(first.filter((t) => t.conversation === "channel").length, 30);
  assert.equal(first.filter((t) => t.conversation === "im").length, 10);
  const polled: CursorMap = {};
  for (const t of first)
    polled[t.id] = { polledAt: "2026-09-28T01:00:00.000Z" };
  const second = orderTargets(channels, dms, polled);
  assert.equal(second.length, 40);
  assert.deepEqual(
    second.slice(0, 15).map((t) => t.id),
    channels.slice(30).map((t) => t.id),
  );
  assert.deepEqual(
    second.slice(30, 32).map((t) => t.id),
    ["D010", "D011"],
  );
});

test("200 dormant DMs never delay a picked channel, and every DM is still read in turn", () => {
  const channels = Array.from({ length: 5 }, (_, i) => channel(i));
  const dms = Array.from({ length: 200 }, (_, i) => dm(i));
  const cursors: CursorMap = {};
  const reads = new Map<string, number>();
  for (let poll = 0; poll < 6; poll += 1) {
    const at = `2026-09-28T00:${String(poll).padStart(2, "0")}:00.000Z`;
    const out = orderTargets(channels, dms, cursors);
    assert.equal(out.length, 40);
    for (const t of out) {
      cursors[t.id] = { polledAt: at };
      reads.set(t.id, (reads.get(t.id) ?? 0) + 1);
    }
  }
  for (const c of channels) assert.equal(reads.get(c.id), 6);
  for (const d of dms) assert.ok(reads.has(d.id), `${d.id} never read`);
});

test("with 45 channels every DM is still read within a few polls", () => {
  const channels = Array.from({ length: 45 }, (_, i) => channel(i));
  const dms = [dm(1), dm(2)];
  const cursors: CursorMap = {};
  const reads = new Map<string, number>();
  for (let poll = 0; poll < 6; poll += 1) {
    const at = `2026-09-28T00:${String(poll).padStart(2, "0")}:00.000Z`;
    for (const t of orderTargets(channels, dms, cursors)) {
      cursors[t.id] = { polledAt: at };
      reads.set(t.id, (reads.get(t.id) ?? 0) + 1);
    }
  }
  for (const t of [...channels, ...dms]) {
    assert.ok((reads.get(t.id) ?? 0) >= 3, `${t.id} read too rarely`);
  }
});

test("on first sight channels come before DMs", () => {
  const out = orderTargets([channel(1)], [dm(1)], {});
  assert.deepEqual(
    out.map((t) => t.id),
    ["C001", "D001"],
  );
});

test("never-read targets come first, id breaks ties, and the list never exceeds the cap", () => {
  const out = orderTargets([channel(2), channel(1), channel(3)], [], {
    C001: { polledAt: "2026-09-28T00:00:00.000Z" },
  });
  assert.deepEqual(
    out.map((t) => t.id),
    ["C002", "C003", "C001"],
  );
  assert.equal(
    orderTargets(
      Array.from({ length: 100 }, (_, i) => channel(i)),
      [],
      {},
    ).length,
    40,
  );
  assert.equal(orderTargets([channel(1), channel(2)], [], {}, 1).length, 1);
  assert.deepEqual(
    orderTargets([channel(1)], [dm(1), dm(2)], {}, 1).map((t) => t.id),
    ["D001"],
  );
});

test("the history window starts 600 s before the cursor, or 24 h back on first sight", () => {
  assert.equal(historyOldest("1700000600.000100", 0), "1700000000.000100");
  assert.equal(historyOldest("1700000600", 0), "1700000000.000000");
  assert.equal(
    historyOldest(undefined, 1_700_086_400_000),
    "1700000000.000000",
  );
});

test("the cursor moves to the newest ts and never backwards", () => {
  const at = "2026-09-28T00:00:00.000Z";
  assert.deepEqual(
    nextCursorState(
      undefined,
      [{ ts: "1700000001.000001" }, { ts: "1700000003.000001" }],
      at,
    ),
    { cursor: "1700000003.000001", polledAt: at },
  );
  assert.deepEqual(nextCursorState(undefined, [], at), { polledAt: at });
  const prev = { cursor: "1700000005.000000", polledAt: "x" };
  assert.deepEqual(nextCursorState(prev, [], at), {
    cursor: "1700000005.000000",
    polledAt: at,
  });
  assert.deepEqual(nextCursorState(prev, [{ ts: "1700000004.999999" }], at), {
    cursor: "1700000005.000000",
    polledAt: at,
  });
  assert.deepEqual(nextCursorState(prev, [{ ts: "1700000005.000001" }], at), {
    cursor: "1700000005.000001",
    polledAt: at,
  });
});
