import assert from "node:assert/strict";
import { test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";

isolateEnv();
const { store } = await import("./board.store.js");
await store.load();

const AT = "2026-09-25T10:00:00.000Z";

test("a cursor set before a restart is read back after it", async () => {
  await store.setSourceCursors("meeting", {
    "meeting:granola": { cursor: AT, polledAt: AT },
  });
  await store.load();
  assert.deepEqual(store.getSourceCursors("meeting"), {
    "meeting:granola": { cursor: AT, polledAt: AT },
  });
});

test("clearing meeting cursors leaves another source's entry in place", async () => {
  await store.setSourceCursors("slack", {
    "slack:C1": { cursor: "1.2", polledAt: AT },
  });
  await store.setSourceCursors("meeting", {
    "meeting:granola": { cursor: AT, polledAt: AT },
  });
  await store.setSourceCursors("meeting", {});
  await store.load();
  assert.deepEqual(store.getSourceCursors("meeting"), {});
  assert.deepEqual(store.getSourceCursors("slack"), {
    "slack:C1": { cursor: "1.2", polledAt: AT },
  });
});

test("a key outside the source prefix is refused and nothing changes", async () => {
  await store.setSourceCursors("meeting", {
    "meeting:granola": { cursor: AT, polledAt: AT },
  });
  await assert.rejects(
    store.setSourceCursors("meeting", {
      "slack:C1": { cursor: "x", polledAt: AT },
    }),
    /must start with meeting:/,
  );
  assert.equal(store.getSourceCursors("slack")["slack:C1"]?.cursor, "1.2");
  assert.deepEqual(Object.keys(store.getSourceCursors("meeting")), [
    "meeting:granola",
  ]);
});

test("malformed stored cursors are dropped on load", async () => {
  const { openBoardDb } = await import("./board-db.js");
  const db = openBoardDb();
  db.persist(
    [],
    {
      syncedAt: null,
      workspaceFolders: [],
      lastUsed: null,
      sourceCursors: {
        "meeting:good": { cursor: AT, polledAt: AT },
        "meeting:no-polled": { cursor: AT } as never,
        "meeting:bad-cursor": { cursor: 7, polledAt: AT } as never,
      },
    },
    [],
  );
  await store.load();
  assert.deepEqual(store.getSourceCursors("meeting"), {
    "meeting:good": { cursor: AT, polledAt: AT },
  });
});
