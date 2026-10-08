import assert from "node:assert/strict";
import { test } from "node:test";
import { sectionState, staleBadgeText } from "./section-state.js";

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

test("the stale badge shows only when the stream is disconnected", () => {
  const at = Date.parse("2026-10-07T12:41:00Z");
  assert.equal(staleBadgeText("connected", at, "UTC"), null);
  assert.equal(staleBadgeText("connecting", at, "UTC"), null);
  assert.equal(staleBadgeText("disconnected", at, "UTC"), "Data from 12:41");
  assert.equal(staleBadgeText("disconnected", 0, "UTC"), null);
});
