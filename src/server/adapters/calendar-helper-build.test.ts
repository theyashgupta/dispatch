import assert from "node:assert/strict";
import { test } from "node:test";

const scriptPath = "../../../scripts/build-calendar-helper.mjs";
const { skipReason, mustFail } = (await import(scriptPath)) as {
  skipReason: (platform: string, hasSwiftc: boolean) => string | null;
  mustFail: (required: boolean, binaryExists: boolean) => boolean;
};

test("the build is skipped off macOS or without swiftc and runs otherwise", () => {
  assert.equal(skipReason("linux", true), "not macOS");
  assert.equal(skipReason("darwin", false), "swiftc not found");
  assert.equal(skipReason("darwin", true), null);
});

test("--require makes a missing helper binary fatal and nothing else is", () => {
  assert.equal(mustFail(true, false), true);
  assert.equal(mustFail(true, true), false);
  assert.equal(mustFail(false, false), false);
  assert.equal(mustFail(false, true), false);
});
