import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatSynced,
  syncStatusView,
  type SyncStatusInput,
} from "./sync-status.js";

const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const base: SyncStatusInput = {
  syncedAt: ago(30_000),
  connection: "connected",
  pollIntervalMs: 60_000,
  syncWarning: null,
  syncUnreachable: false,
  noSource: false,
  now: NOW,
};

const view = (over: Partial<SyncStatusInput>) =>
  syncStatusView({ ...base, ...over });

test("formatSynced rounds to just now, seconds and minutes", () => {
  assert.equal(formatSynced(NOW, NOW), "Synced just now");
  assert.equal(formatSynced(NOW - 4_999, NOW), "Synced just now");
  assert.equal(formatSynced(NOW - 5_000, NOW), "Synced 5s ago");
  assert.equal(formatSynced(NOW - 59_000, NOW), "Synced 59s ago");
  assert.equal(formatSynced(NOW - 60_000, NOW), "Synced 1m ago");
  assert.equal(formatSynced(NOW - 125_000, NOW), "Synced 2m ago");
  assert.equal(formatSynced(NOW + 9_000, NOW), "Synced just now");
});

test("a fresh sync reads the relative time on a connected dot", () => {
  assert.deepEqual(view({}), {
    text: "Synced 30s ago",
    tone: "ok",
    dotTitle: "Connected",
  });
});

test("no source returns nothing unless the stream is disconnected", () => {
  assert.equal(view({ noSource: true }), null);
  assert.deepEqual(view({ noSource: true, connection: "disconnected" }), {
    text: "Disconnected, reconnecting…",
    tone: "down",
    dotTitle: "Disconnected, reconnecting…",
  });
});

test("disconnected wins over every other state", () => {
  assert.equal(
    view({
      connection: "disconnected",
      syncedAt: null,
      syncUnreachable: true,
      syncWarning: "warn",
    })?.text,
    "Disconnected, reconnecting…",
  );
});

test("a null syncedAt reads Syncing on an ok dot", () => {
  assert.deepEqual(view({ syncedAt: null }), {
    text: "Syncing…",
    tone: "ok",
    dotTitle: "Connected",
  });
});

test("unreachable with a valid time shows the last sync on the reconnecting dot", () => {
  assert.deepEqual(view({ syncUnreachable: true }), {
    text: "Reconnecting… (last synced Synced 30s ago)",
    tone: "reconnecting",
    dotTitle: "Reconnecting…",
  });
});

test("unreachable with an unparseable time drops the last sync and keeps the ok dot", () => {
  assert.deepEqual(view({ syncUnreachable: true, syncedAt: "not a date" }), {
    text: "Reconnecting…",
    tone: "ok",
    dotTitle: "Connected",
  });
});

test("an unparseable time reads plain Synced", () => {
  assert.equal(view({ syncedAt: "not a date" })?.text, "Synced");
});

test("a sync older than twice the poll interval is stale", () => {
  const syncedAt = ago(121_000);
  const expected = `Linear sync stale since ${new Date(
    syncedAt,
  ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  assert.deepEqual(view({ syncedAt, syncWarning: "warn" }), {
    text: expected,
    tone: "stale",
    dotTitle: "Sync stale",
  });
});

test("exactly twice the poll interval is not stale, and a null interval never is", () => {
  assert.equal(view({ syncedAt: ago(120_000) })?.tone, "ok");
  assert.equal(
    view({ syncedAt: ago(999_000), pollIntervalMs: null })?.tone,
    "ok",
  );
});

test("a sync warning replaces the relative time while not stale", () => {
  assert.deepEqual(view({ syncWarning: "Linear rate limited" }), {
    text: "Linear rate limited",
    tone: "ok",
    dotTitle: "Connected",
  });
});
