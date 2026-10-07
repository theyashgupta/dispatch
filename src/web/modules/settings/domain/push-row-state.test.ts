import assert from "node:assert/strict";
import { test } from "node:test";
import { pushEnableError, pushRowState } from "./push-row-state.js";

const base = {
  ios: false,
  standalone: false,
  supported: true,
  pending: null,
  permission: "default",
  hasSubscription: false,
} as const;

void test("an iOS browser outside the Home Screen app needs the install steps", () => {
  assert.equal(
    pushRowState({ ...base, ios: true, supported: false }),
    "ios-needs-install",
  );
});

void test("an installed iOS app falls through to the support check", () => {
  assert.equal(
    pushRowState({ ...base, ios: true, standalone: true, supported: false }),
    "unsupported",
  );
});

void test("a pending action outranks the permission", () => {
  assert.equal(
    pushRowState({ ...base, pending: "enabling", permission: "denied" }),
    "enabling",
  );
  assert.equal(
    pushRowState({ ...base, pending: "disabling", permission: "granted" }),
    "disabling",
  );
});

void test("a denied permission blocks push", () => {
  assert.equal(pushRowState({ ...base, permission: "denied" }), "denied");
});

void test("push is enabled only with a granted permission and a subscription", () => {
  assert.equal(
    pushRowState({ ...base, permission: "granted", hasSubscription: true }),
    "enabled",
  );
  assert.equal(
    pushRowState({ ...base, permission: "granted", hasSubscription: false }),
    "default",
  );
  assert.equal(
    pushRowState({ ...base, permission: "granted", hasSubscription: null }),
    "default",
  );
});

void test("an enable error maps the cap and the generic failure", () => {
  assert.equal(
    pushEnableError({ ok: false, error: "too-many-subscriptions" }, "granted"),
    "cap",
  );
  assert.equal(
    pushEnableError({ ok: false, error: "generic" }, "default"),
    "generic",
  );
  assert.equal(pushEnableError({ ok: true }, "granted"), null);
});

void test("a denied permission clears the enable error", () => {
  assert.equal(
    pushEnableError({ ok: false, error: "generic" }, "denied"),
    null,
  );
});
