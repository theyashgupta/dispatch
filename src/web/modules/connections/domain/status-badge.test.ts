import assert from "node:assert/strict";
import { test } from "node:test";
import { statusBadgeState } from "./status-badge.js";

test("connected is the success tone with the account text", () => {
  assert.deepEqual(statusBadgeState({ kind: "connected", account: "ada" }), {
    tone: "success",
    label: "Connected",
    account: "ada",
  });
});

test("connected without an account has no account text", () => {
  assert.deepEqual(statusBadgeState({ kind: "connected" }), {
    tone: "success",
    label: "Connected",
  });
});

test("error is the danger tone with the message", () => {
  assert.deepEqual(statusBadgeState({ kind: "error", message: "Nope" }), {
    tone: "danger",
    label: "Nope",
  });
});

test("every other kind is neutral with its label", () => {
  assert.equal(statusBadgeState({ kind: "checking" }).label, "Checking");
  assert.equal(
    statusBadgeState({ kind: "disconnected" }).label,
    "Not connected",
  );
  assert.equal(statusBadgeState({ kind: "soon" }).label, "Coming soon");
  assert.equal(statusBadgeState({ kind: "off" }).label, "Off");
  assert.equal(statusBadgeState({ kind: "off" }).tone, "neutral");
});
