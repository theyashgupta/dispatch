import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChannelRef } from "./channel-ref.js";

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
