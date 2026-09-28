import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROFILE_BRIEF_MAX,
  PROFILE_HANDLE_MAX,
  PROFILE_HANDLES_MAX,
  PROFILE_TEXT_MAX,
  parseProfile,
} from "./profile.js";

const ok = (input: unknown) => {
  const result = parseProfile(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.ok ? result.value : {};
};

const refused = (input: unknown, pattern: RegExp) => {
  const result = parseProfile(input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, pattern);
};

test("each text field passes at its limit and fails one over", () => {
  for (const [key, max] of [
    ["name", PROFILE_TEXT_MAX],
    ["email", PROFILE_TEXT_MAX],
    ["role", PROFILE_TEXT_MAX],
    ["brief", PROFILE_BRIEF_MAX],
  ] as const) {
    assert.equal(ok({ [key]: "a".repeat(max) })[key]?.length, max);
    refused({ [key]: "a".repeat(max + 1) }, new RegExp(`^${key} `));
  }
});

test("the limit applies after trimming", () => {
  assert.equal(
    ok({ name: `  ${"a".repeat(PROFILE_TEXT_MAX)}  ` }).name?.length,
    PROFILE_TEXT_MAX,
  );
});

test("20 handles pass and 21 fail; a handle of 100 passes and 101 fails", () => {
  const handles = (n: number) => Array.from({ length: n }, (_, i) => `h${i}`);
  assert.equal(
    ok({ handles: handles(PROFILE_HANDLES_MAX) }).handles?.length,
    20,
  );
  refused({ handles: handles(PROFILE_HANDLES_MAX + 1) }, /at most 20 handles/);
  assert.deepEqual(ok({ handles: ["a".repeat(PROFILE_HANDLE_MAX)] }).handles, [
    "a".repeat(PROFILE_HANDLE_MAX),
  ]);
  refused({ handles: ["a".repeat(PROFILE_HANDLE_MAX + 1)] }, /each handle/);
});

test("a huge list of distinct handles is refused fast and duplicates do not count", () => {
  const many = Array.from({ length: 200_000 }, (_, i) => `h${i}`);
  const start = performance.now();
  refused({ handles: many }, /at most 20 handles/);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 200, `took ${elapsed} ms`);
  const repeated = Array.from({ length: 25 }, (_, i) => ["a", "b", "c"][i % 3]);
  assert.deepEqual(ok({ handles: repeated }).handles, ["a", "b", "c"]);
});

test("handles as a string, a non-string handle and a non-string field are refused", () => {
  refused({ handles: "@ada" }, /handles must be a list/);
  refused({ handles: ["@ada", 3] }, /each handle must be text/);
  refused({ name: 42 }, /name must be text/);
});

test("blanks become absent, handles are trimmed and de-duplicated, unknown keys are dropped", () => {
  assert.deepEqual(
    ok({
      name: "  Ada  ",
      email: "   ",
      role: "",
      brief: null,
      handles: [" @ada ", "@ada", "", "  ", "ada-gh"],
      admin: true,
    }),
    { name: "Ada", handles: ["@ada", "ada-gh"] },
  );
  assert.deepEqual(ok({ handles: ["", " "] }), {});
  assert.deepEqual(ok({}), {});
});

test("anything but an object is refused", () => {
  for (const input of [null, undefined, "x", 3, []]) {
    refused(input, /profile must be an object/);
  }
});

test("the cap stops the scan: 21 distinct handles then a non-string fail on the count", () => {
  const handles: unknown[] = Array.from({ length: 21 }, (_, i) => `h${i}`);
  handles.push(42);
  refused({ handles }, /at most 20 handles/);
});

test("null handles are skipped and a padded handle is measured after trim", () => {
  assert.deepEqual(ok({ name: "Ada", handles: null }), { name: "Ada" });
  const padded = `  ${"a".repeat(PROFILE_HANDLE_MAX)}  `;
  assert.deepEqual(ok({ handles: [padded] }).handles, [
    "a".repeat(PROFILE_HANDLE_MAX),
  ]);
});
