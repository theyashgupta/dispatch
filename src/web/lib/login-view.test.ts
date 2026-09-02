import test from "node:test";
import assert from "node:assert/strict";
import {
  isForeignLogin,
  isSubmittableCode,
  loginInFlight,
  sameLoginView,
  viewAccountId,
} from "./login-view.js";

void test("isSubmittableCode rejects empty, multiline, and oversized codes", () => {
  assert.equal(isSubmittableCode("abc"), true);
  assert.equal(isSubmittableCode("  abc  "), true);
  assert.equal(isSubmittableCode(""), false);
  assert.equal(isSubmittableCode("   "), false);
  assert.equal(isSubmittableCode("a\nb"), false);
  assert.equal(isSubmittableCode("a\rb"), false);
  assert.equal(isSubmittableCode("x".repeat(512)), true);
  assert.equal(isSubmittableCode("x".repeat(513)), false);
});

void test("loginInFlight is true only for starting, awaiting-code, finishing", () => {
  assert.equal(loginInFlight({ state: "idle" }), false);
  assert.equal(loginInFlight({ state: "starting", accountId: "a" }), true);
  assert.equal(
    loginInFlight({ state: "awaiting-code", accountId: "a", url: "u" }),
    true,
  );
  assert.equal(loginInFlight({ state: "finishing", accountId: "a" }), true);
  assert.equal(loginInFlight({ state: "error", message: "m" }), false);
  assert.equal(
    loginInFlight({
      state: "done",
      account: {
        id: "a",
        email: "e",
        orgName: "",
        subscriptionType: "",
        isDefault: false,
        usage: { status: "unavailable", windows: [], fetchedAt: null },
      },
    }),
    false,
  );
});

void test("viewAccountId reads the id from in-flight and done views only", () => {
  assert.equal(viewAccountId({ state: "idle" }), null);
  assert.equal(viewAccountId({ state: "error", message: "m" }), null);
  assert.equal(viewAccountId({ state: "starting", accountId: "a" }), "a");
  assert.equal(
    viewAccountId({
      state: "done",
      account: {
        id: "z",
        email: "e",
        orgName: "",
        subscriptionType: "",
        isDefault: false,
        usage: { status: "unavailable", windows: [], fetchedAt: null },
      },
    }),
    "z",
  );
});

void test("isForeignLogin truth table", () => {
  assert.equal(isForeignLogin(null, null, true), false);
  assert.equal(isForeignLogin("a", null, false), false);
  assert.equal(isForeignLogin("a", "a", false), false);
  assert.equal(isForeignLogin("a", "b", false), true);
  assert.equal(isForeignLogin("a", "b", true), true);
  assert.equal(isForeignLogin(null, "b", true), false);
  assert.equal(isForeignLogin(null, "b", false), true);
});

void test("sameLoginView compares by content", () => {
  assert.equal(
    sameLoginView(
      { state: "starting", accountId: "a" },
      { state: "starting", accountId: "a" },
    ),
    true,
  );
  assert.equal(
    sameLoginView(
      { state: "starting", accountId: "a" },
      { state: "awaiting-code", accountId: "a", url: "u" },
    ),
    false,
  );
});
