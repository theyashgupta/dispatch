import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mapSentryDetail,
  type RawSentryEvent,
  type RawSentryIssueDetail,
} from "./sentry-issue.js";

const issue: RawSentryIssueDetail = {
  id: "101",
  title: "TypeError: cannot read id",
  culprit: "resolveUser(src/users)",
  permalink: "https://acme.sentry.io/issues/101/",
  shortId: "API-101",
  level: "fatal",
  count: "1234",
  userCount: 7,
  firstSeen: "2026-09-20T09:00:00Z",
  lastSeen: "2026-09-25T09:00:00Z",
  status: "unresolved",
  project: { slug: "api" },
};

const frames = Array.from({ length: 40 }, (_, i) => ({
  function: `fn${i}`,
  filename: `src/f${i}.ts`,
  lineNo: i + 1,
  colNo: 3,
  inApp: i % 2 === 1,
  module: `m${i}`,
  context: [[i + 1, `line ${i}`]] as [number, string][],
}));

const event: RawSentryEvent = {
  entries: [
    { type: "request", data: { values: null } },
    {
      type: "exception",
      data: {
        values: [
          { type: "CauseError", value: "inner", stacktrace: { frames: [] } },
          {
            type: "TypeError",
            value: "cannot read id",
            stacktrace: { frames },
          },
        ],
      },
    },
    {
      type: "breadcrumbs",
      data: {
        values: Array.from({ length: 30 }, (_, i) => ({
          timestamp: `2026-09-25T08:${String(i).padStart(2, "0")}:00Z`,
          category: "console",
          level: "info",
          message: `step ${i}`,
          type: "default",
        })),
      },
    },
  ],
  tags: [
    { key: "env", value: "prod" },
    { key: "release", value: "1.2.3" },
  ],
  logger: "server",
  platform: "node",
};

test("keeps the newest 25 frames newest first with their context lines", () => {
  const detail = mapSentryDetail(issue, event);
  assert.equal(detail.frames.length, 25);
  assert.equal(detail.frames[0]?.function, "fn39");
  assert.equal(detail.frames[24]?.function, "fn15");
  assert.deepEqual(detail.frames[0], {
    function: "fn39",
    file: "src/f39.ts",
    line: 40,
    column: 3,
    inApp: true,
    module: "m39",
    context: [{ line: 40, code: "line 39" }],
  });
});

test("reads the outermost chained exception and keeps the last 12 breadcrumbs oldest first", () => {
  const detail = mapSentryDetail(issue, event);
  assert.deepEqual(detail.exception, {
    type: "TypeError",
    value: "cannot read id",
  });
  assert.equal(detail.breadcrumbs.length, 12);
  assert.equal(detail.breadcrumbs[0]?.message, "step 18");
  assert.equal(detail.breadcrumbs[11]?.message, "step 29");
});

test("answers the count as a number with the impact fields, tags, logger and platform", () => {
  const detail = mapSentryDetail(issue, event);
  assert.equal(detail.count, 1234);
  assert.equal(detail.userCount, 7);
  assert.equal(detail.firstSeen, "2026-09-20T09:00:00Z");
  assert.equal(detail.project, "api");
  assert.equal(detail.shortId, "API-101");
  assert.deepEqual(detail.tags, [
    { key: "env", value: "prod" },
    { key: "release", value: "1.2.3" },
  ]);
  assert.equal(detail.logger, "server");
  assert.equal(detail.platform, "node");
});

test("an event with no exception or breadcrumb entries maps to null and empty lists", () => {
  const detail = mapSentryDetail(
    { id: "7", title: "t", count: "x" },
    { entries: [{ type: "message", data: {} }] },
  );
  assert.equal(detail.exception, null);
  assert.deepEqual(detail.frames, []);
  assert.deepEqual(detail.breadcrumbs, []);
  assert.deepEqual(detail.tags, []);
  assert.equal(detail.count, 0);
  assert.equal(detail.logger, null);
  assert.equal(detail.permalink, null);
});

test("a missing event maps like an empty one", () => {
  const detail = mapSentryDetail(issue, null);
  assert.equal(detail.exception, null);
  assert.deepEqual(detail.frames, []);
  assert.equal(detail.platform, null);
});

test("frame fields of the wrong type become null and malformed context lines are dropped", () => {
  const detail = mapSentryDetail(issue, {
    entries: [
      {
        type: "exception",
        data: {
          values: [
            {
              type: "E",
              stacktrace: {
                frames: [
                  {
                    absPath: "/app/x.ts",
                    lineNo: null,
                    context: [
                      [1, "ok"],
                      ["2", "bad"],
                    ] as [number, string][],
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  });
  assert.deepEqual(detail.frames[0], {
    function: null,
    file: "/app/x.ts",
    line: null,
    column: null,
    inApp: false,
    module: null,
    context: [{ line: 1, code: "ok" }],
  });
  assert.deepEqual(detail.exception, { type: "E", value: null });
});
