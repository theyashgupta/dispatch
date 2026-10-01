import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cardStatusFrom,
  CONNECTION_ERROR_COPY,
  existingCredentialLabel,
  GITHUB_ERROR_COPY,
} from "./connection-status.js";

test("a GitHub report maps to the card status with GitHub copy", () => {
  assert.deepEqual(
    cardStatusFrom(
      { configured: true, connected: true, via: "gh", account: "g5-tester" },
      GITHUB_ERROR_COPY,
    ),
    { kind: "connected", account: "g5-tester" },
  );
  assert.deepEqual(
    cardStatusFrom(
      { configured: true, connected: false, via: "gh", error: "rejected" },
      GITHUB_ERROR_COPY,
    ),
    { kind: "error", message: GITHUB_ERROR_COPY.rejected },
  );
  assert.deepEqual(
    cardStatusFrom(
      { configured: true, connected: false, via: "gh" },
      GITHUB_ERROR_COPY,
    ),
    { kind: "disconnected" },
  );
});

test("an SSO block names the authorization link in the message", () => {
  const status = cardStatusFrom(
    {
      configured: true,
      connected: false,
      via: "vault",
      error: "sso-required",
      ssoUrl: "https://github.com/orgs/acme/sso?x=1",
    },
    GITHUB_ERROR_COPY,
  );
  assert.deepEqual(status, {
    kind: "error",
    message: `${GITHUB_ERROR_COPY["sso-required"]} Authorize it at https://github.com/orgs/acme/sso?x=1`,
  });
});

test("the Linear card keeps its own copy by default", () => {
  assert.deepEqual(
    cardStatusFrom({
      configured: true,
      connected: false,
      error: "unreachable",
    }),
    { kind: "error", message: CONNECTION_ERROR_COPY.unreachable },
  );
  assert.match(GITHUB_ERROR_COPY.unreachable, /GitHub/);
  assert.match(CONNECTION_ERROR_COPY.unreachable, /Linear/);
});

test("the existing-credential button shows only when a credential exists and the source is off", () => {
  assert.equal(existingCredentialLabel(null), undefined);
  assert.equal(
    existingCredentialLabel({ configured: false, connected: false }),
    undefined,
  );
  assert.equal(
    existingCredentialLabel({ configured: true, connected: false, via: "gh" }),
    "Use gh login",
  );
  assert.equal(
    existingCredentialLabel({
      configured: true,
      connected: false,
      enabled: true,
      via: "vault",
      error: "rejected",
    }),
    undefined,
  );
  assert.equal(
    existingCredentialLabel({
      configured: true,
      connected: false,
      via: "vault",
    }),
    "Use the Vault token",
  );
  assert.equal(
    existingCredentialLabel({
      configured: true,
      connected: true,
      enabled: true,
      via: "gh",
    }),
    undefined,
  );
  assert.equal(
    existingCredentialLabel({ configured: true, connected: false }),
    undefined,
  );
});
