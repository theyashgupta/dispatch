import assert from "node:assert/strict";
import { test } from "node:test";
import { queryClient } from "./query-client.js";

test("queries default to no retry, a 30 second staleTime and no refetch on window focus", () => {
  const { queries } = queryClient.getDefaultOptions();
  assert.equal(queries?.retry, 0);
  assert.equal(queries?.staleTime, 30_000);
  assert.equal(queries?.refetchOnWindowFocus, false);
});

test("mutations default to no retry and the always network mode", () => {
  const { mutations } = queryClient.getDefaultOptions();
  assert.equal(mutations?.retry, 0);
  assert.equal(mutations?.networkMode, "always");
});
