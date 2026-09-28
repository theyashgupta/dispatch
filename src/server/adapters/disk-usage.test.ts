import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diskUsageKb } from "./disk-usage.js";

void test("a real directory reports at least the size of its file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-du-"));
  try {
    fs.writeFileSync(path.join(dir, "blob"), Buffer.alloc(64 * 1024, 1));
    const kb = await diskUsageKb(dir);
    assert.ok(kb !== null && kb >= 64, `expected >= 64, got ${kb}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test("a missing path returns null instead of throwing", async () => {
  const missing = path.join(os.tmpdir(), "dispatch-du-missing-9f2c", "x");
  assert.equal(await diskUsageKb(missing), null);
});

void test("an unreadable subdirectory keeps du's printed total instead of reading as unknown", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-du-partial-"));
  const locked = path.join(dir, "locked");
  try {
    fs.writeFileSync(path.join(dir, "blob"), Buffer.alloc(64 * 1024, 1));
    fs.mkdirSync(locked);
    fs.writeFileSync(path.join(locked, "x"), "x");
    fs.chmodSync(locked, 0o000);
    const kb = await diskUsageKb(dir);
    assert.ok(kb !== null && kb >= 64, `expected >= 64, got ${kb}`);
  } finally {
    fs.chmodSync(locked, 0o700);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
