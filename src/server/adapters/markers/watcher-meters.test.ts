import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isolateEnv } from "../../test-support/fixtures.js";
import type { SessionMeters } from "../../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { recordSessionMeters } = await import("./watcher.js");
after(() => env.cleanup());

const dir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "status-line",
);
const fixture = (name: string) => fs.readFileSync(path.join(dir, name), "utf8");

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function fakeStore(written: boolean) {
  const calls: { id: string; session: string; meters: SessionMeters }[] = [];
  const original = store.setSessionMetersIfSession.bind(store);
  store.setSessionMetersIfSession = (id, session, meters) => {
    calls.push({ id, session, meters });
    return Promise.resolve(written);
  };
  return {
    calls,
    restore: () => {
      store.setSessionMetersIfSession = original;
    },
  };
}

void test("an unchanged status line skips the store call", async () => {
  const { calls, restore } = fakeStore(true);
  try {
    const full = fixture("full.txt");
    recordSessionMeters("card-1", "dsp-meters-1", full);
    await flush();
    recordSessionMeters("card-1", "dsp-meters-1", full);
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].meters.contextPercent, 38);

    recordSessionMeters("card-1", "dsp-meters-1", fixture("fast-1m.txt"));
    await flush();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].meters.contextPercent, 52);

    recordSessionMeters("card-1", "dsp-meters-1", "hello\nworld\n");
    await flush();
    assert.equal(calls.length, 2);
  } finally {
    restore();
  }
});

void test("a refused write makes the next identical pane call the store again", async () => {
  const { calls, restore } = fakeStore(false);
  try {
    const full = fixture("full.txt");
    recordSessionMeters("card-2", "dsp-meters-2", full);
    await flush();
    recordSessionMeters("card-2", "dsp-meters-2", full);
    await flush();
    assert.equal(calls.length, 2);
  } finally {
    restore();
  }
});
