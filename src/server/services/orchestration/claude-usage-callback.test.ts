import test from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";

isolateEnv();
process.env.DISPATCH_USAGE_URL = "http://127.0.0.1:1/usage";
const usage = await import("./claude-usage.js");

const ADDED = "11111111-1111-4111-8111-111111111111";

void test("the listener runs after a Default refresh and not after an added account refresh", async () => {
  let calls = 0;
  usage.onDefaultUsageRefreshed(() => {
    calls += 1;
  });
  await usage.refreshUsage(ADDED);
  assert.equal(calls, 0);
  await usage.refreshUsage("default");
  assert.equal(calls, 1);
  await usage.refreshAllUsage();
  assert.equal(calls, 2);
});
