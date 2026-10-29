import test from "node:test";
import assert from "node:assert/strict";
import type { EnvPresence } from "../../../shared/types.js";
import {
  missingPushover,
  pushoverStartLine,
  type PushoverName,
} from "./pushover-check.js";

const presence = (
  user: EnvPresence,
  token: EnvPresence,
): Record<PushoverName, EnvPresence> => ({
  PUSHOVER_USER_KEY: user,
  PUSHOVER_APP_TOKEN: token,
});

void test("an empty user key with a filled token reports the user key", () => {
  assert.deepEqual(missingPushover(presence("empty", "filled")), [
    "PUSHOVER_USER_KEY",
  ]);
});

void test("an empty token with a filled user key reports the token", () => {
  assert.deepEqual(missingPushover(presence("filled", "empty")), [
    "PUSHOVER_APP_TOKEN",
  ]);
});

void test("two empty names are reported in name order", () => {
  assert.deepEqual(missingPushover(presence("empty", "empty")), [
    "PUSHOVER_USER_KEY",
    "PUSHOVER_APP_TOKEN",
  ]);
});

void test("two filled names report nothing and give no line", () => {
  const missing = missingPushover(presence("filled", "filled"));
  assert.deepEqual(missing, []);
  assert.equal(pushoverStartLine(missing), null);
});

void test("two unset names mean notifications are off and give no line", () => {
  const missing = missingPushover(presence("unset", "unset"));
  assert.deepEqual(missing, []);
  assert.equal(pushoverStartLine(missing), null);
});

void test("an unset name counts as missing when the other name is declared", () => {
  assert.deepEqual(missingPushover(presence("unset", "empty")), [
    "PUSHOVER_USER_KEY",
    "PUSHOVER_APP_TOKEN",
  ]);
  assert.deepEqual(missingPushover(presence("filled", "unset")), [
    "PUSHOVER_APP_TOKEN",
  ]);
});

void test("the start line names one missing value", () => {
  assert.equal(
    pushoverStartLine(["PUSHOVER_USER_KEY"]),
    "[notify] loop phase notifications are on, but PUSHOVER_USER_KEY is empty or not set, so no phase notification is sent",
  );
});

void test("the start line names two missing values", () => {
  assert.equal(
    pushoverStartLine(["PUSHOVER_USER_KEY", "PUSHOVER_APP_TOKEN"]),
    "[notify] loop phase notifications are on, but PUSHOVER_USER_KEY and PUSHOVER_APP_TOKEN are empty or not set, so no phase notification is sent",
  );
});
