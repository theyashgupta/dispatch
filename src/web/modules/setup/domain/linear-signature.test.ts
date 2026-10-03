import assert from "node:assert/strict";
import { test } from "node:test";
import type { SourceConnection } from "../../../../shared/types.js";
import {
  linearChanged,
  noteLinear,
  type LinearSeen,
} from "./linear-signature.js";

const none: LinearSeen = { baseline: null, latest: null };
const off: SourceConnection = {
  configured: false,
  connected: false,
  enabled: false,
};
const on: SourceConnection = {
  configured: true,
  connected: true,
  enabled: true,
  account: "Gee",
};

test("nothing seen is not a change", () => {
  assert.equal(linearChanged(none), false);
});

test("the first read sets the baseline and the latest", () => {
  const seen = noteLinear(none, off);
  assert.equal(seen.baseline, "false|false|");
  assert.equal(seen.latest, "false|false|");
  assert.equal(linearChanged(seen), false);
});

test("a later read that differs is a change and keeps the baseline", () => {
  const seen = noteLinear(noteLinear(none, off), on);
  assert.equal(seen.baseline, "false|false|");
  assert.equal(seen.latest, "true|true|Gee");
  assert.equal(linearChanged(seen), true);
});

test("a read back to the baseline is not a change", () => {
  assert.equal(
    linearChanged(noteLinear(noteLinear(noteLinear(none, off), on), off)),
    false,
  );
});
