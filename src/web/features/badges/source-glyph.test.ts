import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCE_ACCENT } from "./source-accent.js";
import { SOURCE_GLYPH } from "./SourceBadge.js";

test("every accent entry has a glyph and no glyph lacks an accent", () => {
  assert.deepEqual(
    Object.keys(SOURCE_GLYPH).sort(),
    Object.keys(SOURCE_ACCENT).sort(),
  );
});
