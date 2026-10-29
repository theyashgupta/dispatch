import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";
import { isolateEnv } from "../test-support/fixtures.js";

isolateEnv();
const { store } = await import("./board.store.js");
await store.load();

test("cursors set for a source read back without the prefix and survive a reload", async () => {
  await store.setSourceCursors("slack", {
    C0G6ENG: {
      cursor: "1700000000.000100",
      polledAt: "2026-09-28T00:00:00.000Z",
    },
    D0G6DM1: { polledAt: "2026-09-28T00:00:00.000Z" },
  });
  assert.deepEqual(store.getSourceCursors("slack"), {
    C0G6ENG: {
      cursor: "1700000000.000100",
      polledAt: "2026-09-28T00:00:00.000Z",
    },
    D0G6DM1: { polledAt: "2026-09-28T00:00:00.000Z" },
  });
  await store.load();
  assert.deepEqual(store.getSourceCursors("slack"), {
    C0G6ENG: {
      cursor: "1700000000.000100",
      polledAt: "2026-09-28T00:00:00.000Z",
    },
    D0G6DM1: { polledAt: "2026-09-28T00:00:00.000Z" },
  });
  assert.deepEqual(store.getSourceCursors("github"), {});
});

test("a set replaces every key of that source and leaves another source's keys", async () => {
  await store.setSourceCursors("other", {
    X: { polledAt: "2026-09-28T01:00:00.000Z" },
  });
  await store.setSourceCursors("slack", {
    C0G6GEN: {
      cursor: "1700000009.000000",
      polledAt: "2026-09-28T02:00:00.000Z",
    },
  });
  assert.deepEqual(store.getSourceCursors("slack"), {
    C0G6GEN: {
      cursor: "1700000009.000000",
      polledAt: "2026-09-28T02:00:00.000Z",
    },
  });
  assert.deepEqual(store.getSourceCursors("other"), {
    X: { polledAt: "2026-09-28T01:00:00.000Z" },
  });
  await store.load();
  assert.deepEqual(Object.keys(store.getSourceCursors("slack")), ["C0G6GEN"]);
  assert.deepEqual(Object.keys(store.getSourceCursors("other")), ["X"]);
});

test("a read hands out copies, so a caller cannot change the stored cursors", () => {
  const read = store.getSourceCursors("slack");
  read.C0G6GEN.cursor = "0";
  assert.equal(
    store.getSourceCursors("slack").C0G6GEN.cursor,
    "1700000009.000000",
  );
});

test("a change in the enabled sources is broadcast once; the same set is not", () => {
  let changes = 0;
  const count = () => {
    changes += 1;
  };
  store.on("change", count);
  store.setEnabledSources(["slack"]);
  store.setEnabledSources(["slack"]);
  store.setEnabledSources([]);
  store.off("change", count);
  assert.equal(changes, 2);
});

test("the Pushover gap broadcasts on a changed list only and leaves the snapshot when cleared", () => {
  let changes = 0;
  const count = () => {
    changes += 1;
  };
  store.on("change", count);
  const first = new Date("2026-10-21T10:00:00Z");
  store.setPushoverMissing(["PUSHOVER_USER_KEY"], first);
  store.setPushoverMissing(["PUSHOVER_USER_KEY"], new Date());
  assert.equal(changes, 1);
  assert.equal(store.pushoverMissing()?.since, first.toISOString());
  store.setPushoverMissing(["PUSHOVER_USER_KEY", "PUSHOVER_APP_TOKEN"]);
  assert.equal(changes, 2);
  assert.equal(store.pushoverMissing()?.since, first.toISOString());
  store.setPushoverMissing([]);
  store.setPushoverMissing([]);
  store.off("change", count);
  assert.equal(changes, 3);
  assert.equal(store.pushoverMissing(), null);
  assert.equal("pushoverMissing" in store.snapshot(DEFAULT_BOARD_KEY), false);
});
