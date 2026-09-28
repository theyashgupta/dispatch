import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";
import { fakeItem, makeFakeSource } from "../test-support/fake-source.js";
import type { SourceCursor } from "../../shared/types.js";

isolateEnv();
const { store } = await import("../store/board.store.js");
const { pollNow, startPollers, stopPollers } = await import("./poller.js");
await store.load();

afterEach(() => {
  stopPollers();
  mock.restoreAll();
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 5));
};

type Cursors = Record<string, SourceCursor>;

function cursorSource(
  id: string,
  answer: (seen: Cursors | undefined) => Promise<{ cursors?: Cursors }>,
) {
  const seen: (Cursors | undefined)[] = [];
  const source = makeFakeSource({
    id,
    kind: "append",
    pollIntervalMs: 3_600_000,
    fetch: async (opts) => {
      seen.push(opts?.cursors);
      const { cursors } = await answer(opts?.cursors);
      return {
        issues: [],
        items: [fakeItem(`${id}-${seen.length}`, { source: id })],
        truncated: false,
        ...(cursors ? { cursors } : {}),
      };
    },
  });
  return { source, seen };
}

const at = (s: string): SourceCursor => ({
  cursor: s,
  polledAt: "2026-09-28T00:00:00.000Z",
});

test("cursors a fetch returns are stored after the upsert and passed to the next fetch", async () => {
  const { source, seen } = cursorSource("cur-a", () =>
    Promise.resolve({ cursors: { T1: at("1.000001") } }),
  );
  startPollers([source]);
  await settle();
  assert.deepEqual(store.getSourceCursors("cur-a"), { T1: at("1.000001") });
  pollNow("cur-a");
  await settle();
  assert.deepEqual(seen[0], {});
  assert.deepEqual(seen[1], { T1: at("1.000001") });
});

test("a failed item upsert never changes the stored cursors", async () => {
  await store.setSourceCursors("cur-b", { T1: at("1.000001") });
  mock.method(store, "upsertItems", () =>
    Promise.reject(new Error("disk full")),
  );
  const { source } = cursorSource("cur-b", () =>
    Promise.resolve({ cursors: { T1: at("9.000009") } }),
  );
  startPollers([source]);
  await settle();
  assert.deepEqual(store.getSourceCursors("cur-b"), { T1: at("1.000001") });
});

test("a thrown fetch never changes the stored cursors", async () => {
  await store.setSourceCursors("cur-c", { T1: at("1.000001") });
  const source = makeFakeSource({
    id: "cur-c",
    kind: "append",
    pollIntervalMs: 3_600_000,
    fetch: () => Promise.reject(new Error("slack down")),
  });
  startPollers([source]);
  await settle();
  assert.deepEqual(store.getSourceCursors("cur-c"), { T1: at("1.000001") });
});

test("a poll superseded by pollNow writes no cursors", async () => {
  await store.setSourceCursors("cur-e", { T1: at("1.000001") });
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => {
    release = r;
  });
  let calls = 0;
  const { source, seen } = cursorSource("cur-e", async () => {
    calls += 1;
    if (calls > 1) return {};
    await held;
    return { cursors: { T1: at("9.000009") } };
  });
  startPollers([source]);
  await settle();
  assert.equal(seen.length, 1);
  pollNow("cur-e");
  release();
  await settle();
  assert.equal(seen.length, 2);
  assert.deepEqual(store.getSourceCursors("cur-e"), { T1: at("1.000001") });
});

test("a source that returns no cursors leaves stored cursors untouched", async () => {
  await store.setSourceCursors("cur-d", { T1: at("1.000001") });
  const { source } = cursorSource("cur-d", () => Promise.resolve({}));
  startPollers([source]);
  await settle();
  assert.deepEqual(store.getSourceCursors("cur-d"), { T1: at("1.000001") });
});
