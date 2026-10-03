import assert from "node:assert/strict";
import { test } from "node:test";
import { sentryFailureText } from "./sentry-error-copy.js";

const KNOWN: [string, string][] = [
  ["rejected", "Sentry rejected the token. Reconnect Sentry in Settings."],
  [
    "forbidden",
    "Sentry refused this action. Check that the token has the event:write scope.",
  ],
  ["no-credential", "Sentry is not connected. Connect it in Settings."],
  ["not-found", "Sentry could not find this issue."],
  ["unknown item", "This error is no longer listed."],
  ["rate-limited", "Sentry's rate limit was reached. Try again in a minute."],
  [
    "unreachable",
    "Couldn't reach Sentry. Check your connection and try again.",
  ],
];

test("every known code maps to its sentence", () => {
  for (const [code, text] of KNOWN) assert.equal(sentryFailureText(code), text);
});

test("an unknown code reads as unreachable", () => {
  assert.equal(sentryFailureText("teapot"), sentryFailureText("unreachable"));
});

test("an inherited object key reads as unreachable", () => {
  assert.equal(
    sentryFailureText("constructor"),
    sentryFailureText("unreachable"),
  );
});
