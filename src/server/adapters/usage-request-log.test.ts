import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendUsageRequest,
  type UsageRequestLine,
} from "./usage-request-log.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "usage-request-log-"));

void test.after(() => {
  fs.chmodSync(root, 0o700);
  fs.rmSync(root, { recursive: true, force: true });
});

function line(overrides: Partial<UsageRequestLine> = {}): UsageRequestLine {
  return {
    ts: "2026-10-11T00:00:00.000Z",
    account: "default",
    caller: "poll",
    status: 200,
    nextInMs: 300_000,
    ...overrides,
  };
}

void test("a line holds exactly the five fields", () => {
  const file = path.join(root, "fields", "usage-requests.jsonl");
  appendUsageRequest(line(), file);
  appendUsageRequest(line({ caller: "manual", status: "network" }), file);
  const rows = fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [
      "account",
      "caller",
      "nextInMs",
      "status",
      "ts",
    ]);
  }
  assert.equal(rows[1].status, "network");
});

void test("the file rotates to .1 before it passes 1 MB and keeps one old file", () => {
  const file = path.join(root, "rotate.jsonl");
  const filler = "x".repeat(1_048_576 - 10);
  fs.writeFileSync(file, filler);
  appendUsageRequest(line({ account: "first" }), file);
  assert.equal(fs.readFileSync(`${file}.1`, "utf8"), filler);
  const rows = fs.readFileSync(file, "utf8").trim().split("\n");
  assert.equal(rows.length, 1);
  assert.equal((JSON.parse(rows[0]) as UsageRequestLine).account, "first");

  const second = "y".repeat(1_048_576 - 10);
  fs.writeFileSync(file, second);
  appendUsageRequest(line({ account: "second" }), file);
  assert.equal(fs.readFileSync(`${file}.1`, "utf8"), second);
  const after = fs.readFileSync(file, "utf8").trim().split("\n");
  assert.equal(after.length, 1);
  assert.equal((JSON.parse(after[0]) as UsageRequestLine).account, "second");
  assert.equal(
    fs.readdirSync(root).filter((f) => f.startsWith("rotate.jsonl")).length,
    2,
  );
});

void test("a write failure does not throw", () => {
  const blocker = path.join(root, "blocker");
  fs.writeFileSync(blocker, "not a directory");
  assert.doesNotThrow(() =>
    appendUsageRequest(line(), path.join(blocker, "usage-requests.jsonl")),
  );
});

void test("the file holds no token text", () => {
  const file = path.join(root, "clean.jsonl");
  appendUsageRequest(line(), file);
  const text = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(text, /sk-ant/);
  assert.doesNotMatch(text, /Bearer/);
});
