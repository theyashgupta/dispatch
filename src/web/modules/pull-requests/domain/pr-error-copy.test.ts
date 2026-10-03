import assert from "node:assert/strict";
import { test } from "node:test";
import { prFailureText } from "./pr-error-copy.js";

const KNOWN: [string, string][] = [
  ["rejected", "GitHub rejected the token. Reconnect GitHub in Settings."],
  ["no-credential", "GitHub is not connected. Connect it in Settings."],
  ["not-found", "GitHub could not find this pull request."],
  [
    "sso-required",
    "GitHub needs you to authorize the token for this organization's SAML single sign-on.",
  ],
  ["rate-limited", "GitHub's rate limit was reached. Try again in a minute."],
  [
    "unreachable",
    "Couldn't reach GitHub. Check your connection and try again.",
  ],
  ["not-mergeable", "GitHub will not merge this pull request."],
  ["refused", "GitHub refused the review."],
  ["invalid review", "Write a comment before sending."],
];

test("every known code maps to its sentence", () => {
  for (const [code, text] of KNOWN) assert.equal(prFailureText(code), text);
});

test("an unknown code reads as unreachable", () => {
  assert.equal(prFailureText("teapot"), prFailureText("unreachable"));
});

test("an inherited object key reads as unreachable", () => {
  assert.equal(prFailureText("constructor"), prFailureText("unreachable"));
});

test("a GitHub message is appended to the sentence", () => {
  assert.equal(
    prFailureText("not-mergeable", "Head branch was modified"),
    "GitHub will not merge this pull request. GitHub said: Head branch was modified",
  );
});

test("a single sign-on link replaces the GitHub message", () => {
  const text = prFailureText("sso-required", "ignored", "https://sso.example");
  assert.ok(text.includes("https://sso.example"));
  assert.ok(!text.includes("ignored"));
});
