import test from "node:test";
import assert from "node:assert/strict";
import { formatSize } from "./format-size.js";

void test("sizes read in KB, MB and GB at the 1024 boundaries", () => {
  assert.equal(formatSize(0), "0 KB");
  assert.equal(formatSize(1023), "1023 KB");
  assert.equal(formatSize(1024), "1.0 MB");
  assert.equal(formatSize(1048575), "1.0 GB");
  assert.equal(formatSize(1048576), "1.0 GB");
  assert.equal(formatSize(272760), "266.4 MB");
});

void test("an unknown size never reads as zero", () => {
  assert.equal(formatSize(null), "size unknown");
});
