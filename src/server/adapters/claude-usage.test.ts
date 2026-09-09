import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { REAL_USAGE_PAYLOAD } from "../test-support/claude-transcripts.js";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const usage = await import("./claude-usage.js");

void test("mapUsageResponse maps the recorded real payload, prefers limits[] and labels the scoped weekly window", () => {
  const windows = usage.mapUsageResponse(REAL_USAGE_PAYLOAD);
  assert.deepEqual(
    windows.map((w) => [w.kind, w.label, w.percent, w.isActive]),
    [
      ["session", "Session", 53, true],
      ["weekly_all", "Weekly", 11, false],
      ["weekly_scoped", "Weekly Fable", 13, false],
    ],
  );
  assert.equal(windows[0].resetsAt, "2026-09-01T22:50:00.475Z");
  assert.deepEqual(
    windows.map((w) => [w.periodStart, w.periodEnd]),
    [
      ["2026-09-01T17:50:00.475Z", "2026-09-01T22:50:00.475Z"],
      ["2026-09-01T03:00:00.475Z", "2026-09-08T03:00:00.475Z"],
      ["2026-09-01T03:00:00.475Z", "2026-09-08T03:00:00.475Z"],
    ],
  );
});

void test("mapUsageResponse derives no period for an unknown kind or a missing reset", () => {
  const windows = usage.mapUsageResponse({
    limits: [
      { kind: "mystery_bucket", percent: 7, resets_at: "2026-09-01T22:50:00Z" },
      { kind: "session", percent: 9, resets_at: null },
      { kind: "weekly_all", percent: 9 },
    ],
  });
  assert.deepEqual(
    windows.map((w) => [w.kind, w.periodStart, w.periodEnd]),
    [
      ["mystery_bucket", null, null],
      ["session", null, null],
      ["weekly_all", null, null],
    ],
  );
});

void test("mapUsageResponse falls back to five_hour and seven_day, converts numeric seconds, clamps", () => {
  const windows = usage.mapUsageResponse({
    five_hour: { utilization: 120.4, resets_at: 1756767000 },
    seven_day: { utilization: -3, resets_at: 1756767000000 },
  });
  assert.deepEqual(
    windows.map((w) => [w.kind, w.percent, w.resetsAt, w.periodStart]),
    [
      ["session", 100, "2025-09-01T22:50:00.000Z", "2025-09-01T17:50:00.000Z"],
      ["weekly_all", 0, "2025-09-01T22:50:00.000Z", "2025-08-25T22:50:00.000Z"],
    ],
  );
  assert.deepEqual(usage.mapUsageResponse({}), []);
  assert.deepEqual(usage.mapUsageResponse(null), []);
  assert.deepEqual(
    usage.mapUsageResponse({
      limits: [{ kind: "session", percent: "x" }, { percent: 5 }],
    }),
    [],
  );
  assert.deepEqual(
    usage
      .mapUsageResponse({ limits: [{ kind: "mystery_bucket", percent: 7 }] })
      .map((w) => w.label),
    ["mystery bucket"],
  );
});

void test("mapUsageResponse maps the enterprise spend budget when there are no rate-limit windows", () => {
  const now = new Date(2026, 8, 9, 12, 0, 0);
  const windows = usage.mapUsageResponse(
    {
      five_hour: null,
      seven_day: null,
      limits: [],
      spend: { percent: 14, severity: "normal", enabled: true },
      extra_usage: { is_enabled: true, utilization: 14.48 },
    },
    now,
  );
  assert.deepEqual(
    windows.map((w) => [w.kind, w.label, w.percent, w.resetsAt, w.isActive]),
    [["spend", "Usage credits", 14, null, true]],
  );
  assert.equal(windows[0].periodStart, new Date(2026, 8, 1).toISOString());
  assert.equal(windows[0].periodEnd, new Date(2026, 9, 1).toISOString());
  const december = usage.mapUsageResponse(
    { spend: { percent: 1, enabled: true } },
    new Date(2026, 11, 31, 23, 59),
  );
  assert.equal(december[0].periodStart, new Date(2026, 11, 1).toISOString());
  assert.equal(december[0].periodEnd, new Date(2027, 0, 1).toISOString());
  assert.deepEqual(
    usage.mapUsageResponse({
      limits: [],
      spend: { percent: 14, enabled: false },
    }),
    [],
  );
});

void test("readAccessToken tries the keychain service first, then the credentials file, never throws", async () => {
  const dir = path.join(env.root, "usage-dir");
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === "darwin") {
    assert.equal(
      await usage.readAccessToken("Claude Code-credentials", dir),
      "sk-ant-oat01-FAKE-HOME-ACCT",
    );
    process.env.FAKE_SECURITY_DENY_ACCOUNT = "1";
    assert.equal(
      await usage.readAccessToken("Claude Code-credentials", dir),
      "sk-ant-oat01-FAKE-HOME",
    );
    delete process.env.FAKE_SECURITY_DENY_ACCOUNT;
  }
  assert.equal(
    await usage.readAccessToken("Claude Code-credentials-nope", dir),
    null,
  );
  fs.writeFileSync(
    path.join(dir, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: { accessToken: "sk-ant-oat01-FAKE-FILE" },
    }),
  );
  assert.equal(
    await usage.readAccessToken("Claude Code-credentials-nope", dir),
    "sk-ant-oat01-FAKE-FILE",
  );
  fs.writeFileSync(path.join(dir, ".credentials.json"), "garbage");
  assert.equal(
    await usage.readAccessToken("Claude Code-credentials-nope", dir),
    null,
  );
});

void test("fetchUsage honours DISPATCH_USAGE_URL at call time and sends the bearer token there", async () => {
  let seen: string | undefined;
  const server = http.createServer((req, res) => {
    seen = req.headers.authorization;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ limits: [{ kind: "session", percent: 4 }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  process.env.DISPATCH_USAGE_URL = `http://127.0.0.1:${port}/usage`;
  try {
    const result = await usage.fetchUsage("sk-ant-oat01-FAKE", "test-agent");
    assert.equal(result.status, 200);
    assert.equal(seen, "Bearer sk-ant-oat01-FAKE");
    assert.deepEqual(
      usage.mapUsageResponse(result.body).map((w) => [w.kind, w.percent]),
      [["session", 4]],
    );
  } finally {
    delete process.env.DISPATCH_USAGE_URL;
    server.close();
  }
});
