import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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
});

void test("mapUsageResponse falls back to five_hour and seven_day, converts numeric seconds, clamps", () => {
  const windows = usage.mapUsageResponse({
    five_hour: { utilization: 120.4, resets_at: 1756767000 },
    seven_day: { utilization: -3, resets_at: 1756767000000 },
  });
  assert.deepEqual(
    windows.map((w) => [w.kind, w.percent, w.resetsAt]),
    [
      ["session", 100, "2025-09-01T22:50:00.000Z"],
      ["weekly_all", 0, "2025-09-01T22:50:00.000Z"],
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
  const windows = usage.mapUsageResponse({
    five_hour: null,
    seven_day: null,
    limits: [],
    spend: { percent: 14, severity: "normal", enabled: true },
    extra_usage: { is_enabled: true, utilization: 14.48 },
  });
  assert.deepEqual(
    windows.map((w) => [w.kind, w.label, w.percent, w.resetsAt, w.isActive]),
    [["spend", "Usage credits", 14, null, true]],
  );
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
