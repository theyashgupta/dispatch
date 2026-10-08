import assert from "node:assert/strict";
import { test } from "node:test";
import { isSlackChannel, parseChannelRef } from "./channel-ref.js";

const cases: [string, string | null][] = [
  ["https://acme.slack.com/archives/C0G6ENG", "C0G6ENG"],
  ["https://acme.slack.com/archives/C0G6ENG/p1700000000000100", "C0G6ENG"],
  ["https://app.slack.com/client/T0G6/C0G6GEN", "C0G6GEN"],
  ["https://app.slack.com/client/T0G6/G0G6SEC/thread/x", "G0G6SEC"],
  ["C0G6ENG", "C0G6ENG"],
  ["G0G6SEC", "G0G6SEC"],
  ["  C0G6ENG  ", "C0G6ENG"],
  ["https://acme.slack.com/archives/C0G6ENG/", "C0G6ENG"],
  [
    "https://acme.slack.com/archives/C0G6ENG?thread_ts=1.2&cid=C0G6ENG",
    "C0G6ENG",
  ],
  ["http://127.0.0.1:47975/acme/archives/C0G6ENG/p1700000000000100", "C0G6ENG"],
  ["D0G6DM1", null],
  ["https://acme.slack.com/archives/D0G6DM1", null],
  ["https://example.com/some/page", null],
  ["javascript:alert(1)", null],
  ["c0g6eng", null],
  ["", null],
  ["not a channel", null],
];

for (const [input, expected] of cases) {
  test(`parseChannelRef(${JSON.stringify(input)}) is ${String(expected)}`, () => {
    assert.equal(parseChannelRef(input), expected);
  });
}

test("a picked channel needs a Slack channel name, or its own id as the name", () => {
  const ok = (name: unknown, id = "C0G6ENG") => isSlackChannel({ id, name });
  assert.ok(ok("general"));
  assert.ok(ok("dev.ops_1-x"));
  assert.ok(ok("a".repeat(80)));
  assert.ok(ok("C0G6ENG"));
  assert.equal(ok("a".repeat(81)), false);
  for (const name of ["проект", "日本語", "Dev-Team"]) {
    assert.ok(ok(name), name);
  }
  assert.equal(ok("line\nbreak"), false);
  assert.equal(ok("bidi\u202eflip"), false);
  assert.equal(ok("line\u2028sep"), false);
  assert.equal(ok("para\u2029sep"), false);
  assert.equal(ok(""), false);
  assert.equal(ok(7), false);
});
