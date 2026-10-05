import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_CONNECTIONS, SOON_CONNECTIONS } from "./connection-meta.js";

test("ALL_CONNECTIONS lists the sources in card order", () => {
  assert.deepEqual(
    ALL_CONNECTIONS.map((c) => c.source),
    ["linear", "github", "sentry", "slack", "meeting", "calendar"],
  );
});

test("every SOON_CONNECTIONS entry is in ALL_CONNECTIONS", () => {
  for (const soon of SOON_CONNECTIONS) {
    assert.ok(ALL_CONNECTIONS.some((c) => c.source === soon.source));
  }
});
