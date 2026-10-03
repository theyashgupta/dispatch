import assert from "node:assert/strict";
import { test } from "node:test";
import type { z } from "zod";
import { DEFAULT_TERMINAL_APPEARANCE } from "../../shared/terminal-appearance.js";
import {
  archiveRetentionBodySchema,
  boardQuerySchema,
  claudeArgsBodySchema,
  cleanupDelayBodySchema,
  dirsQuerySchema,
  filtersBodySchema,
  optionsQuerySchema,
  searchQuerySchema,
  terminalBodySchema,
  workspacePathSchema,
} from "./board-schemas.js";

function firstCode(schema: z.ZodType, input: unknown): string | undefined {
  const result = schema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

const DONE = "doneLimit must be a whole number between 1 and 5000";
const Q_RANGE = "q must be between 2 and 100 characters";
const CLEANUP = "cleanup delay must be a whole number of days between 0 and 90";
const RETENTION =
  "archive retention must be a whole number of days between 0 and 365";
const ARGS =
  "claude arguments must be a string of 4000 characters or fewer with no control characters";
const filters = {
  includeActive: true,
  assignees: ["u1"],
  projects: [],
  teams: [],
  currentCycle: false,
};

test("boardQuerySchema leaves an absent doneLimit undefined and parses a valid one", () => {
  assert.deepEqual(boardQuerySchema.parse({}), {});
  assert.deepEqual(boardQuerySchema.parse({ doneLimit: "5000" }), {
    doneLimit: 5000,
  });
});

test("boardQuerySchema rejects a blank, out-of-range, fractional or repeated doneLimit", () => {
  for (const doneLimit of ["", " ", "0", "5001", "1.5", "x", ["1", "2"]]) {
    assert.equal(firstCode(boardQuerySchema, { doneLimit }), DONE);
  }
});

test("searchQuerySchema trims q and bounds it in UTF-16 units", () => {
  assert.deepEqual(searchQuerySchema.parse({ q: "  ab " }), { q: "ab" });
  assert.equal(searchQuerySchema.safeParse({ q: "\u{1F600}" }).success, true);
  assert.equal(firstCode(searchQuerySchema, { q: "a".repeat(101) }), Q_RANGE);
  assert.equal(firstCode(searchQuerySchema, { q: " a " }), Q_RANGE);
});

test("searchQuerySchema names a missing or repeated q as required", () => {
  for (const input of [{}, { q: ["ab", "cd"] }, undefined]) {
    assert.equal(firstCode(searchQuerySchema, input), "q is required");
  }
});

test("workspacePathSchema keeps the path untrimmed and rejects a missing, blank or wrong-type one", () => {
  assert.deepEqual(workspacePathSchema.parse({ path: " ~/x " }), {
    path: " ~/x ",
  });
  for (const input of [undefined, [], {}, { path: "  " }, { path: 1 }]) {
    assert.equal(firstCode(workspacePathSchema, input), "path is required");
  }
});

test("dirsQuerySchema accepts an absent or string path and rejects a repeated one", () => {
  assert.deepEqual(dirsQuerySchema.parse({}), {});
  assert.deepEqual(dirsQuerySchema.parse({ path: "" }), { path: "" });
  assert.equal(
    firstCode(dirsQuerySchema, { path: ["a", "b"] }),
    "invalid path",
  );
});

test("optionsQuerySchema accepts the three list dimensions only", () => {
  for (const dimension of ["assignees", "projects", "teams"]) {
    assert.equal(optionsQuerySchema.safeParse({ dimension }).success, true);
  }
  for (const input of [{}, { dimension: "cycle" }, { dimension: ["teams"] }]) {
    assert.equal(firstCode(optionsQuerySchema, input), "invalid dimension");
  }
});

test("filtersBodySchema passes the client's filters object through untouched", () => {
  const out = filtersBodySchema.parse({ filters });
  assert.equal(out.filters, filters);
  assert.deepEqual(Object.keys(out.filters), Object.keys(filters));
});

test("filtersBodySchema rejects a missing body, an extra key and each wrong field", () => {
  for (const input of [
    undefined,
    [],
    {},
    { filters: null },
    { filters: [] },
    { filters: { ...filters, extra: 1 } },
    { filters: { ...filters, assignees: [1] } },
    { filters: { ...filters, projects: "p" } },
    { filters: { ...filters, teams: undefined } },
    { filters: { ...filters, currentCycle: "no" } },
    { filters: { ...filters, includeActive: 0 } },
  ]) {
    assert.equal(firstCode(filtersBodySchema, input), "invalid filters");
  }
});

test("cleanupDelayBodySchema accepts 0 to 90 whole days only", () => {
  for (const cleanupDelayDays of [0, 90]) {
    assert.equal(
      cleanupDelayBodySchema.safeParse({ cleanupDelayDays }).success,
      true,
    );
  }
  for (const input of [
    undefined,
    {},
    { cleanupDelayDays: -1 },
    { cleanupDelayDays: 91 },
    { cleanupDelayDays: 1.5 },
    { cleanupDelayDays: "5" },
    { cleanupDelayDays: Infinity },
  ]) {
    assert.equal(firstCode(cleanupDelayBodySchema, input), CLEANUP);
  }
});

test("archiveRetentionBodySchema accepts 0 to 365 whole days only", () => {
  assert.equal(
    archiveRetentionBodySchema.safeParse({ archiveRetentionDays: 365 }).success,
    true,
  );
  for (const input of [
    undefined,
    { archiveRetentionDays: 366 },
    { archiveRetentionDays: 0.5 },
    { archiveRetentionDays: null },
  ]) {
    assert.equal(firstCode(archiveRetentionBodySchema, input), RETENTION);
  }
});

test("terminalBodySchema returns the normalized appearance", () => {
  const out = terminalBodySchema.parse({
    ...DEFAULT_TERMINAL_APPEARANCE,
    cursor: "#AABBCC",
    extra: 1,
  });
  assert.deepEqual(out, { ...DEFAULT_TERMINAL_APPEARANCE, cursor: "#aabbcc" });
});

test("terminalBodySchema gives the first failing field's message in check order", () => {
  const good = DEFAULT_TERMINAL_APPEARANCE;
  const cases: [unknown, string][] = [
    [undefined, "terminal appearance must be an object"],
    [[], "terminal appearance must be an object"],
    [
      { ...good, background: "x", cursor: "x" },
      "background must be a #rrggbb color",
    ],
    [
      { ...good, foreground: "x", cursor: "x" },
      "foreground must be a #rrggbb color",
    ],
    [{ ...good, cursor: "x", fontSize: 1 }, "cursor must be a #rrggbb color"],
    [
      { ...good, fontSize: 33, fontFamily: "x" },
      "fontSize must be a whole number between 8 and 32",
    ],
    [
      { ...good, fontFamily: "x" },
      "fontFamily must be one of the offered fonts",
    ],
  ];
  for (const [input, code] of cases) {
    assert.equal(firstCode(terminalBodySchema, input), code);
  }
});

test("claudeArgsBodySchema accepts empty, newline and 4000 UTF-16 units", () => {
  for (const claudeArgs of ["", "a\nb", "\u{1F600}".repeat(2000)]) {
    assert.equal(claudeArgsBodySchema.safeParse({ claudeArgs }).success, true);
  }
});

test("claudeArgsBodySchema rejects a non-string, 4001 units and a control byte", () => {
  for (const input of [
    undefined,
    {},
    { claudeArgs: 1 },
    { claudeArgs: "a".repeat(4001) },
    { claudeArgs: "\u{1F600}".repeat(2000) + "a" },
    { claudeArgs: "a\x15" },
  ]) {
    assert.equal(firstCode(claudeArgsBodySchema, input), ARGS);
  }
});
