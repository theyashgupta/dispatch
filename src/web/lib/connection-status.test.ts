import assert from "node:assert/strict";
import { test } from "node:test";
import { CONNECTION_ERROR_COPY, cardStatusFrom } from "./connection-status.js";
import { LINEAR_CONNECTION } from "./connection-meta.js";

test("no report yet reads as checking; an unconfigured source reads as disconnected", () => {
  assert.deepEqual(cardStatusFrom(null), { kind: "checking" });
  assert.deepEqual(cardStatusFrom({ configured: false, connected: false }), {
    kind: "disconnected",
  });
});

test("a connected source carries its account when the server sent one", () => {
  assert.deepEqual(
    cardStatusFrom({
      configured: true,
      connected: true,
      account: "Ada (a@x.dev)",
    }),
    { kind: "connected", account: "Ada (a@x.dev)" },
  );
  assert.deepEqual(cardStatusFrom({ configured: true, connected: true }), {
    kind: "connected",
  });
});

test("an error report maps to the exact copy, configured or not", () => {
  assert.deepEqual(
    cardStatusFrom({ configured: true, connected: false, error: "rejected" }),
    { kind: "error", message: CONNECTION_ERROR_COPY.rejected },
  );
  assert.deepEqual(
    cardStatusFrom({
      configured: false,
      connected: false,
      error: "unreachable",
    }),
    { kind: "error", message: CONNECTION_ERROR_COPY.unreachable },
  );
});

test("a configured source that is not connected and reports no error reads as disconnected", () => {
  assert.deepEqual(cardStatusFrom({ configured: true, connected: false }), {
    kind: "disconnected",
  });
});

test("connected false never maps to connected, even with an account present", () => {
  const status = cardStatusFrom({
    configured: true,
    connected: false,
    account: "Ada",
    error: "rejected",
  });
  assert.equal(status.kind, "error");
});

test("the rejected and unreachable copy match the first-run strings verbatim", () => {
  assert.equal(
    CONNECTION_ERROR_COPY.rejected,
    "Linear rejected that key. Double-check it and try again.",
  );
  assert.equal(
    CONNECTION_ERROR_COPY.unreachable,
    "Couldn't reach Linear. Check your connection and try again.",
  );
  assert.equal(
    CONNECTION_ERROR_COPY.superseded,
    "Linear was disconnected while this key was being checked. Paste it again to reconnect.",
  );
  assert.equal(
    CONNECTION_ERROR_COPY.failed,
    "Dispatch couldn't save the key. Check ~/.dispatch/config.json and try again.",
  );
});

test("the Linear metadata carries four steps, read and write scopes and the token page", () => {
  assert.equal(LINEAR_CONNECTION.steps.length, 4);
  assert.deepEqual(LINEAR_CONNECTION.scopes, ["read", "write"]);
  assert.equal(
    LINEAR_CONNECTION.tokenPageUrl,
    "https://linear.app/settings/account/security",
  );
  assert.equal(LINEAR_CONNECTION.credentialLabel, "Personal API key");
});
