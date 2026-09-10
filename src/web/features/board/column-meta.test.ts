import assert from "node:assert/strict";
import { test } from "node:test";
import { COLUMNS } from "../../../shared/types.js";
import { COLUMN_ACCENT, COLUMN_LABELS } from "./column-meta.js";

test("every rendered column has a board label and an accent token", () => {
  for (const column of COLUMNS) {
    assert.ok(COLUMN_LABELS[column].length > 0, `${column} board label`);
    assert.match(COLUMN_ACCENT[column], /^var\(--col-/, `${column} accent`);
  }
  assert.equal(COLUMN_LABELS.parked, "PARKED");
  assert.equal(COLUMN_ACCENT.parked, "var(--col-parked)");
});
