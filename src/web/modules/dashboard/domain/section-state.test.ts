import assert from "node:assert/strict";
import { test } from "node:test";
import { sectionState } from "./section-state.js";

test("a query with no data and no error is loading", () => {
  assert.deepEqual(
    sectionState([
      { data: [], error: null },
      { data: undefined, error: null },
    ]),
    { kind: "loading" },
  );
});

test("an input with an error shows the error even while another input loads", () => {
  assert.deepEqual(
    sectionState([
      { data: undefined, error: null },
      { data: undefined, error: new Error("HTTP 500") },
    ]),
    { kind: "error", message: "HTTP 500" },
  );
});

test("a failed refetch keeps the section ready when data exists", () => {
  assert.deepEqual(sectionState([{ data: [], error: new Error("x") }]), {
    kind: "ready",
  });
});
