import assert from "node:assert/strict";
import { test } from "node:test";
import { stubToCard } from "./search-stub.js";

test("stubToCard keeps the four search fields and fills the rest with placeholders", () => {
  assert.deepEqual(
    stubToCard({
      id: "c1",
      identifier: "LOCAL-1",
      title: "Found",
      column: "parked",
    }),
    {
      id: "c1",
      identifier: "LOCAL-1",
      title: "Found",
      column: "parked",
      issueId: "",
      description: null,
      priority: 0,
      updatedAt: "1970-01-01T00:00:00.000Z",
    },
  );
});
