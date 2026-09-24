import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArchiveRetention } from "./archive-retention.js";

test("parseArchiveRetention accepts whole days in [0, 365] and rejects everything else", () => {
  assert.equal(parseArchiveRetention("30"), 30);
  assert.equal(parseArchiveRetention(" 0 "), 0);
  assert.equal(parseArchiveRetention("365"), 365);
  for (const bad of ["", "366", "-1", "1.5", "abc", "30days"]) {
    assert.equal(
      parseArchiveRetention(bad),
      null,
      `rejects ${JSON.stringify(bad)}`,
    );
  }
});
