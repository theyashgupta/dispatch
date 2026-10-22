import assert from "node:assert/strict";
import path from "node:path";
import { after, test } from "node:test";
import { buildAttentionQueue } from "../../../shared/attention-queue.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import type { EnvPresence } from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { envVaultPresence } = await import("../infra/vault.js");
const { PUSHOVER_NAMES } = await import("../domain/pushover-check.js");
const { checkPushover } = await import("./pushover-watch.js");
await store.load();
after(() => env.cleanup());

const NOW = new Date("2026-10-21T12:00:00Z");

function presence(user: EnvPresence, app: EnvPresence) {
  return () =>
    Promise.resolve({ PUSHOVER_USER_KEY: user, PUSHOVER_APP_TOKEN: app });
}

function queue() {
  return buildAttentionQueue({
    boardKey: DEFAULT_BOARD_KEY,
    cards: [],
    decisions: [],
    pushoverMissing: store.snapshot(DEFAULT_BOARD_KEY).pushoverMissing,
    now: NOW,
  });
}

test("filled values leave no item and no snapshot field", async () => {
  await checkPushover(presence("empty", "empty"));
  await checkPushover(presence("filled", "filled"));
  assert.deepEqual(queue(), []);
  assert.equal("pushoverMissing" in store.snapshot(DEFAULT_BOARD_KEY), false);
});

test("empty values give one item naming both, with no network call", async (t) => {
  store.setPushoverMissing([]);
  const fetchSpy = t.mock.method(globalThis, "fetch", () =>
    Promise.reject(new Error("no network")),
  );
  const missing = await checkPushover(presence("empty", "empty"));
  assert.deepEqual(missing, ["PUSHOVER_USER_KEY", "PUSHOVER_APP_TOKEN"]);
  const items = queue();
  assert.equal(items.length, 1);
  assert.equal(items[0]?.kind, "pushover_missing");
  assert.match(
    items[0]?.text ?? "",
    /PUSHOVER_USER_KEY and PUSHOVER_APP_TOKEN/,
  );
  assert.equal(fetchSpy.mock.callCount(), 0);
});

test("a second check with the same values keeps one item and its since", async () => {
  store.setPushoverMissing([]);
  await checkPushover(presence("empty", "empty"));
  const before = store.pushoverMissing()?.since;
  assert.ok(before);
  await checkPushover(presence("empty", "empty"));
  assert.equal(queue().length, 1);
  assert.equal(store.pushoverMissing()?.since, before);
});

test("a check with filled values clears the item", async () => {
  await checkPushover(presence("empty", "empty"));
  assert.equal(queue().length, 1);
  await checkPushover(presence("filled", "filled"));
  assert.deepEqual(queue(), []);
});

test("notifications off gives no item", async () => {
  await checkPushover(presence("empty", "empty"));
  await checkPushover(presence("unset", "unset"));
  assert.deepEqual(queue(), []);
});

test("the snapshot never holds a value and names only the empty name", async () => {
  store.setPushoverMissing([]);
  const missing = path.join(env.root, "missing");
  const missingPaths = {
    schema: path.join(missing, "schema.keys"),
    values: path.join(missing, "values.env"),
  };
  await checkPushover(() =>
    envVaultPresence(
      PUSHOVER_NAMES,
      { PUSHOVER_USER_KEY: "fake-user-168", PUSHOVER_APP_TOKEN: "" },
      missingPaths,
    ),
  );
  const json = JSON.stringify(store.snapshot(DEFAULT_BOARD_KEY));
  assert.equal(json.includes("fake-user-168"), false);
  assert.deepEqual(store.pushoverMissing()?.names, ["PUSHOVER_APP_TOKEN"]);
});
