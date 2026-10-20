import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const usage = await import("./claude-usage.js");
const { accountDir, upsertAccount, setActiveAccount, setManagedDefault } =
  await import("./claude-accounts.js");
const { setOrchestrationConfig } = await import("../infra/config-holder.js");
setOrchestrationConfig({ linearApiKey: "", port: 4700 });
const { USAGE_REQUEST_LOG_PATH } =
  await import("../../adapters/usage-request-log.js");

let status = 200;
let hits = 0;
let body = JSON.stringify({ five_hour: { utilization: 40 } });
const server = http.createServer((_req, res) => {
  hits += 1;
  res.writeHead(status, {
    "content-type": "application/json",
    ...(status === 429 ? { "retry-after": "60" } : {}),
  });
  res.end(body);
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.DISPATCH_USAGE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/usage`;

const LOG = USAGE_REQUEST_LOG_PATH;

void test.after(() => {
  server.close();
  env.cleanup();
});

void test.beforeEach(() => {
  usage.forgetUsage("default");
  status = 200;
  hits = 0;
  body = JSON.stringify({ five_hour: { utilization: 40 } });
  fs.rmSync(LOG, { force: true });
});

function logLines(): { account: string; caller: string; status: unknown }[] {
  if (!fs.existsSync(LOG)) return [];
  return fs
    .readFileSync(LOG, "utf8")
    .trim()
    .split("\n")
    .map(
      (l) =>
        JSON.parse(l) as { account: string; caller: string; status: unknown },
    );
}

async function hold(): Promise<void> {
  status = 429;
  await usage.refreshUsage("default");
  assert.equal(hits, 1);
  assert.equal(usage.getUsage("default").status, "rate-limited");
}

void test("the tick makes no request while the account is held", async () => {
  await hold();
  await usage.runUsageTick();
  assert.equal(hits, 1);
  assert.equal(usage.getUsage("default").status, "rate-limited");
});

void test("a manual refresh inside a hold is too-soon with no request", async () => {
  await hold();
  assert.deepEqual(await usage.refreshUsageManually("default"), {
    ok: false,
    error: "too-soon",
  });
  assert.equal(hits, 1);
});

void test("the limit-surface and fresh-read callers get the cached snapshot inside a hold", async () => {
  await hold();
  for (const caller of ["limit-surface", "fresh-read"] as const) {
    const snapshot = await usage.refreshUsage("default", caller);
    assert.equal(snapshot.status, "rate-limited");
  }
  assert.equal(hits, 1);
});

void test("the login caller gets the cached snapshot inside a hold", async () => {
  await hold();
  const snapshot = await usage.refreshUsage("default", "login");
  assert.equal(snapshot.status, "rate-limited");
  assert.equal(hits, 1);
});

void test("the tick skips an account that is not due and reads it once it is", async () => {
  await usage.refreshUsage("default");
  assert.equal(hits, 1);
  await usage.runUsageTick();
  assert.equal(hits, 1);
  await usage.runUsageTick(Date.now() + 2 * 60 * 60 * 1000);
  assert.equal(hits, 2);
});

void test("a 200 re-plans the next read at least 180 seconds out", async () => {
  const before = Date.now();
  await usage.refreshUsage("default");
  const plan = usage.getUsagePlan("default");
  assert.ok(plan.nextDueAt !== null && plan.nextDueAt >= before + 180_000);
  assert.equal(plan.holdUntil, null);
});

void test("a 401 re-plans the next read 600 seconds out", async () => {
  const before = Date.now();
  status = 401;
  await usage.refreshUsage("default");
  const plan = usage.getUsagePlan("default");
  assert.ok(plan.nextDueAt !== null);
  assert.ok(plan.nextDueAt >= before + 600_000 * 0.9);
  assert.ok(plan.nextDueAt <= Date.now() + 600_000);
  assert.equal(plan.holdUntil, null);
});

void test("a 401 is token-expired when the access token expired and the refresh token lives, else token-rejected", async () => {
  const ADDED = "44444444-4444-4444-8444-444444444444";
  fs.mkdirSync(accountDir(ADDED), { recursive: true });
  const write = (oauth: Record<string, number>): void =>
    fs.writeFileSync(
      path.join(accountDir(ADDED), ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: { accessToken: "sk-ant-oat01-FAKE-IDLE", ...oauth },
      }),
    );
  const errorFor = async (oauth: Record<string, number>): Promise<unknown> => {
    write(oauth);
    usage.forgetUsage(ADDED);
    const snapshot = await usage.refreshUsage(ADDED);
    assert.equal(snapshot.status, "stale");
    return snapshot.error;
  };
  status = 401;
  const past = Date.now() - 60_000;
  const future = Date.now() + 3_600_000;
  assert.equal(await errorFor({ expiresAt: past }), "token-expired");
  assert.equal(
    await errorFor({ expiresAt: past, refreshTokenExpiresAt: future }),
    "token-expired",
  );
  assert.equal(
    await errorFor({ expiresAt: past, refreshTokenExpiresAt: past }),
    "token-rejected",
  );
  assert.equal(await errorFor({ expiresAt: future }), "token-rejected");
  assert.equal(await errorFor({}), "token-rejected");
});

void test("a 429 holds the account for Retry-After plus 900 seconds", async () => {
  const before = Date.now();
  await hold();
  const plan = usage.getUsagePlan("default");
  assert.ok(plan.holdUntil !== null && plan.holdUntil >= before + 960_000);
  assert.equal(plan.nextDueAt, plan.holdUntil);
});

void test("each real request appends one log line with its caller", async () => {
  await usage.refreshUsage("default");
  await usage.refreshUsage("default", "login");
  status = 429;
  await usage.refreshUsage("default", "fresh-read");
  await usage.refreshUsage("default", "limit-surface");
  assert.equal(hits, 3);
  assert.deepEqual(
    logLines().map((l) => [l.account, l.caller, l.status]),
    [
      ["default", "poll", 200],
      ["default", "login", 200],
      ["default", "fresh-read", 429],
    ],
  );
});

void test("two reads of one account at the same time make one request", async () => {
  const [first, second] = await Promise.all([
    usage.refreshUsage("default"),
    usage.runUsageTick(),
  ]);
  assert.equal(first.status, "ok");
  assert.equal(second, undefined);
  assert.equal(hits, 1);
  assert.equal(logLines().length, 1);
});

void test("an account with no token is not read again on the next tick", async () => {
  const ADDED = "11111111-1111-4111-8111-111111111111";
  usage.forgetUsage(ADDED);
  await usage.refreshUsage(ADDED);
  assert.equal(usage.getUsage(ADDED).error, "no-token");
  const plan = usage.getUsagePlan(ADDED);
  assert.ok(plan.nextDueAt !== null && plan.nextDueAt > Date.now());
  assert.equal(logLines().filter((l) => l.account === ADDED).length, 0);
});

void test("a credential with refreshTokenExpiresAt gives loginExpiresAt on the snapshot, and a credential without it gives none", async () => {
  const ADDED = "22222222-2222-4222-8222-222222222222";
  const expiresAt = Date.parse("2026-10-13T00:00:00.000Z");
  fs.mkdirSync(accountDir(ADDED), { recursive: true });
  const credentials = path.join(accountDir(ADDED), ".credentials.json");
  fs.writeFileSync(
    credentials,
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "sk-ant-oat01-FAKE-ADDED",
        refreshTokenExpiresAt: expiresAt,
      },
    }),
  );
  usage.forgetUsage(ADDED);
  const first = await usage.refreshUsage(ADDED);
  assert.equal(first.status, "ok");
  assert.equal(first.loginExpiresAt, new Date(expiresAt).toISOString());
  assert.equal(
    usage.getUsage(ADDED).loginExpiresAt,
    new Date(expiresAt).toISOString(),
  );

  fs.writeFileSync(
    credentials,
    JSON.stringify({
      claudeAiOauth: { accessToken: "sk-ant-oat01-FAKE-ADDED" },
    }),
  );
  usage.forgetUsage(ADDED);
  const second = await usage.refreshUsage(ADDED);
  assert.equal(second.status, "ok");
  assert.equal("loginExpiresAt" in second, false);
});

void test("a 200 that cannot be mapped is logged, re-planned and not read again on the next tick", async () => {
  body = '{"five_hour":{"utilization":5,"resets_at":1e16}}';
  const snapshot = await usage.refreshUsage("default");
  assert.equal(snapshot.status, "error");
  assert.equal(snapshot.error, "bad-response");
  assert.equal(hits, 1);
  const lines = logLines();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].status, 200);
  const plan = usage.getUsagePlan("default");
  assert.ok(plan.nextDueAt !== null && plan.nextDueAt > Date.now());
  await usage.runUsageTick();
  assert.equal(hits, 1);
});

void test("an idle account that becomes the active one is read within 300 seconds", async () => {
  const ADDED = "33333333-3333-4333-8333-333333333333";
  const dir = accountDir(ADDED);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat01-FAKE-NEW" } }),
  );
  await upsertAccount({
    id: ADDED,
    email: "new@example.com",
    orgId: "org",
    orgName: "Org",
    subscriptionType: "max",
    createdAt: "2026-10-01T00:00:00.000Z",
    lastLoginAt: "2026-10-01T00:00:00.000Z",
  });
  usage.forgetUsage(ADDED);
  for (let i = 0; i < 3; i++) await usage.refreshUsage(ADDED);
  const planned = usage.getUsagePlan(ADDED).nextDueAt;
  const t = Date.now();
  assert.ok(planned !== null && planned > t + 500_000);
  await setActiveAccount("default");
  await usage.runUsageTick(t);
  await setActiveAccount(ADDED);
  await usage.runUsageTick(t);
  fs.rmSync(LOG, { force: true });
  await usage.runUsageTick(t + 301_000);
  assert.ok(logLines().some((l) => l.account === ADDED));
  await setActiveAccount("default");
});

void test("the tick never reads Default once a managed default exists", async () => {
  const MANAGED = "44444444-4444-4444-8444-444444444444";
  fs.mkdirSync(accountDir(MANAGED), { recursive: true });
  await upsertAccount({
    id: MANAGED,
    email: "managed@example.com",
    orgId: "org",
    orgName: "Org",
    subscriptionType: "max",
    createdAt: "2026-10-01T00:00:00.000Z",
    lastLoginAt: "2026-10-01T00:00:00.000Z",
  });
  await setManagedDefault(MANAGED);
  try {
    await usage.runUsageTick();
    assert.equal(logLines().filter((l) => l.account === "default").length, 0);
    assert.equal(hits, 0);
  } finally {
    await setManagedDefault(undefined);
  }
  await usage.runUsageTick();
  assert.equal(hits, 1);
});
