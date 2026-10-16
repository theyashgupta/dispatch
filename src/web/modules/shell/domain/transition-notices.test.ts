import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  BoardKey,
  BoardSnapshot,
  Card,
  Column,
} from "../../../../shared/types.js";
import {
  INITIAL_NOTICE_STATE,
  noticeConnection,
  noticeSnapshot,
  noticeVisible,
} from "./transition-notices.js";

const NOW = Date.parse("2026-10-16T12:10:00.000Z");

const card = (
  id: string,
  column: Column,
  columnSince?: string,
  groupId?: string,
): Card =>
  ({
    id,
    identifier: id.toUpperCase(),
    column,
    ...(columnSince === undefined ? {} : { columnSince }),
    ...(groupId === undefined ? {} : { groupId }),
  }) as Card;

const snap = (cards: Card[]): BoardSnapshot => ({
  cards,
  syncedAt: null,
  boardKey: "LOCAL" as BoardKey,
});

void test("rule 1: a session start or success does not notify", () => {
  const seed = noticeSnapshot(
    INITIAL_NOTICE_STATE,
    snap([
      card("a", "todo"),
      card("b", "in_progress"),
      card("c", "in_progress"),
      card("d", "in_progress"),
      card("e", "needs_input"),
    ]),
    NOW,
  );
  assert.deepEqual(seed.notices, []);

  const moved = noticeSnapshot(
    seed.state,
    snap([
      card("a", "in_progress"),
      card("b", "in_review"),
      card("c", "done"),
      card("d", "needs_input"),
      card("e", "needs_input"),
      card("f", "agent_done"),
    ]),
    NOW,
  );
  assert.deepEqual(
    moved.notices.map((c) => c.id),
    ["d", "f"],
  );

  const same = noticeSnapshot(
    moved.state,
    snap([
      card("a", "in_progress"),
      card("b", "in_review"),
      card("c", "done"),
      card("d", "needs_input"),
      card("e", "needs_input"),
      card("f", "agent_done"),
    ]),
    NOW,
  );
  assert.deepEqual(same.notices, []);
});

void test("rule 2: a failure older than 5 minutes does not notify", () => {
  const seed = noticeSnapshot(
    INITIAL_NOTICE_STATE,
    snap([
      card("a", "in_progress"),
      card("b", "in_progress"),
      card("c", "in_progress"),
      card("e", "in_progress"),
    ]),
    NOW,
  );
  assert.deepEqual(seed.notices, []);

  const moved = noticeSnapshot(
    seed.state,
    snap([
      card("a", "needs_input", "2026-10-16T12:05:00.000Z"),
      card("b", "needs_input", "2026-10-16T12:04:59.999Z"),
      card("c", "needs_input"),
      card("d", "needs_input", "2026-10-16T11:10:00.000Z"),
      card("e", "needs_input", "not-a-date"),
    ]),
    NOW,
  );
  assert.deepEqual(
    moved.notices.map((c) => c.id),
    ["a", "c", "e"],
  );
});

void test("a mirrored group member does not notify, its group card does", () => {
  const seed = noticeSnapshot(
    INITIAL_NOTICE_STATE,
    snap([
      card("g", "in_progress"),
      card("m1", "in_progress", undefined, "g"),
      card("m2", "in_progress", undefined, "g"),
    ]),
    NOW,
  );
  assert.deepEqual(seed.notices, []);

  const moved = noticeSnapshot(
    seed.state,
    snap([
      card("g", "needs_input", "2026-10-16T12:09:00.000Z"),
      card("m1", "needs_input", "2026-10-16T12:09:00.000Z", "g"),
      card("m2", "needs_input", undefined, "g"),
    ]),
    NOW,
  );
  assert.deepEqual(
    moved.notices.map((c) => c.id),
    ["g"],
  );
});

void test("rule 3: a reconnect replay does not notify", () => {
  const seed = noticeSnapshot(
    INITIAL_NOTICE_STATE,
    snap([card("a", "in_progress"), card("b", "in_progress")]),
    NOW,
  );
  assert.deepEqual(seed.notices, []);

  const connected = noticeConnection(seed.state, "connected");

  const aMoved = snap([
    card("a", "needs_input", "2026-10-16T12:09:00.000Z"),
    card("b", "in_progress"),
  ]);

  const withoutOutage = noticeSnapshot(connected, aMoved, NOW);
  assert.deepEqual(
    withoutOutage.notices.map((c) => c.id),
    ["a"],
  );

  const outage = noticeConnection(seed.state, "disconnected");
  const reconnected = noticeConnection(outage, "connected");
  const replay = noticeSnapshot(reconnected, aMoved, NOW);
  assert.deepEqual(replay.notices, []);

  const live = noticeSnapshot(
    replay.state,
    snap([
      card("a", "needs_input", "2026-10-16T12:09:00.000Z"),
      card("b", "needs_input", "2026-10-16T12:09:30.000Z"),
    ]),
    NOW,
  );
  assert.deepEqual(
    live.notices.map((c) => c.id),
    ["b"],
  );
});

void test("rule 4: a hidden tab does not replay a backlog when it becomes visible", () => {
  const seed = noticeSnapshot(
    INITIAL_NOTICE_STATE,
    snap([
      card("a", "in_progress"),
      card("b", "in_progress"),
      card("c", "in_progress"),
    ]),
    NOW,
  );
  assert.deepEqual(seed.notices, []);

  const hidden = noticeSnapshot(
    seed.state,
    snap([
      card("a", "needs_input", "2026-10-16T12:08:00.000Z"),
      card("b", "in_progress"),
      card("c", "in_progress"),
    ]),
    NOW,
  );
  assert.deepEqual(
    hidden.notices.map((c) => c.id),
    ["a"],
  );

  const visible = noticeVisible(
    hidden.state,
    Date.parse("2026-10-16T12:09:00.000Z"),
  );

  const backlog = noticeSnapshot(
    visible,
    snap([
      card("a", "needs_input", "2026-10-16T12:08:00.000Z"),
      card("b", "needs_input", "2026-10-16T12:08:30.000Z"),
      card("c", "in_progress"),
    ]),
    Date.parse("2026-10-16T12:09:01.000Z"),
  );
  assert.deepEqual(backlog.notices, []);

  const fresh = noticeSnapshot(
    backlog.state,
    snap([
      card("a", "needs_input", "2026-10-16T12:08:00.000Z"),
      card("b", "needs_input", "2026-10-16T12:08:30.000Z"),
      card("c", "agent_done", "2026-10-16T12:09:20.000Z"),
    ]),
    Date.parse("2026-10-16T12:09:30.000Z"),
  );
  assert.deepEqual(
    fresh.notices.map((c) => c.id),
    ["c"],
  );
});
