import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const usage = await import("./claude-usage.js");

let status = 200;
const percent = 85;
let hits = 0;
const server = http.createServer((_req, res) => {
  hits += 1;
  res.writeHead(status, {
    "content-type": "application/json",
    ...(status === 429 ? { "retry-after": "300" } : {}),
  });
  res.end(JSON.stringify({ five_hour: { utilization: percent } }));
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.DISPATCH_USAGE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/usage`;

void test.after(() => {
  server.close();
  env.cleanup();
});

void test("the account in use is read again only when it is due, and a 429 holds the tick and the manual refresh", async () => {
  await usage.refreshUsage("default");
  assert.equal(hits, 1);
  await usage.runUsageTick();
  assert.equal(hits, 1);
  await usage.runUsageTick(Date.now() + 2 * 60 * 60 * 1000);
  assert.equal(hits, 2);

  status = 429;
  await usage.refreshUsage("default");
  assert.equal(usage.getUsage("default").status, "rate-limited");
  assert.equal(hits, 3);
  await usage.runUsageTick(Date.now() + 60 * 1000);
  assert.equal(hits, 3);
  assert.deepEqual(await usage.refreshUsageManually("default"), {
    ok: false,
    error: "too-soon",
  });
  assert.equal(hits, 3);
});

void test("the general refresh listener sees every account with its snapshot", async () => {
  status = 200;
  const seen: string[] = [];
  usage.onUsageRefreshed((id, snapshot) =>
    seen.push(`${id}:${snapshot.status}`),
  );
  usage.forgetUsage("default");
  await usage.refreshUsage("default");
  await usage.refreshUsage("11111111-1111-4111-8111-111111111111");
  assert.deepEqual(seen, [
    "default:ok",
    "11111111-1111-4111-8111-111111111111:unavailable",
  ]);
});
