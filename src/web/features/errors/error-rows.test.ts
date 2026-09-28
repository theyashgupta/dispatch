import assert from "node:assert/strict";
import { test } from "node:test";
import type { Item } from "../../../shared/types.js";
import { buildErrorRows, groupErrorRows, levelTone } from "./error-rows.js";

function item(
  issueId: string,
  extra: Partial<Item> = {},
  meta: Record<string, string> = {},
): Item {
  return {
    id: `sentry:${issueId}`,
    source: "sentry",
    type: "error",
    title: `Error ${issueId}`,
    snippet: "module.function",
    url: `https://sentry.io/issues/${issueId}`,
    createdAt: "2026-09-25T00:00:00Z",
    priority: 50,
    state: "unread",
    meta: {
      project: "api",
      level: "error",
      count: "3",
      shortId: `PROJ-${issueId}`,
      culprit: "module.function",
      category: "unresolved",
      ...meta,
    },
    ...extra,
  };
}

test("a row maps its item's fields", () => {
  const [row] = buildErrorRows([
    item("1", {}, { category: "assigned", count: "12" }),
  ]);
  assert.equal(row?.issueId, "1");
  assert.equal(row?.count, 12);
  assert.equal(row?.assigned, true);
  assert.equal(row?.unread, true);
});

test("a non-finite count reads as 0", () => {
  const [row] = buildErrorRows([item("1", {}, { count: "not-a-number" })]);
  assert.equal(row?.count, 0);
});

test("a read item is not unread", () => {
  const [row] = buildErrorRows([item("1", { state: "read" })]);
  assert.equal(row?.unread, false);
});

test("done, snoozed and non-Sentry items are dropped", () => {
  const rows = buildErrorRows([
    item("1", { state: "done" }),
    item("3", { state: "snoozed", snoozedUntil: "2099-01-01T00:00:00Z" }),
    { ...item("2"), source: "github", id: "github:acme/api#2" },
  ]);
  assert.deepEqual(rows, []);
});

test("a higher-priority row sorts first even when older", () => {
  const rows = buildErrorRows([
    item("older-assigned", { priority: 75, createdAt: "2026-09-01T00:00:00Z" }),
    item("newer-org-wide", { priority: 50, createdAt: "2026-09-24T00:00:00Z" }),
  ]);
  assert.deepEqual(
    rows.map((r) => r.issueId),
    ["older-assigned", "newer-org-wide"],
  );
});

test("equal priority rows sort newest first", () => {
  const rows = buildErrorRows([
    item("old", { priority: 50, createdAt: "2026-09-01T00:00:00Z" }),
    item("new", { priority: 50, createdAt: "2026-09-24T00:00:00Z" }),
  ]);
  assert.deepEqual(
    rows.map((r) => r.issueId),
    ["new", "old"],
  );
});

test("grouping by project labels rows, with a blank project becoming No project", () => {
  const rows = buildErrorRows([
    item("1", {}, { project: "api" }),
    item("2", {}, { project: "" }),
    item("3", {}, { project: "web" }),
  ]);
  assert.deepEqual(
    groupErrorRows(rows, "project").map((g) => [
      g.label,
      g.rows.map((r) => r.issueId),
    ]),
    [
      ["api", ["1"]],
      ["No project", ["2"]],
      ["web", ["3"]],
    ],
  );
});

test("grouping by level capitalizes the label, with a blank level becoming Unknown", () => {
  const rows = buildErrorRows([
    item("1", {}, { level: "fatal" }),
    item("2", {}, { level: "" }),
    item("3", {}, { level: "warning" }),
  ]);
  assert.deepEqual(
    groupErrorRows(rows, "level").map((g) => g.label),
    ["Fatal", "Unknown", "Warning"],
  );
});

test("levelTone maps fatal and error to danger, warning to warning, and info to neutral", () => {
  assert.equal(levelTone("fatal"), "danger");
  assert.equal(levelTone("error"), "danger");
  assert.equal(levelTone("warning"), "warning");
  assert.equal(levelTone("info"), "neutral");
});
