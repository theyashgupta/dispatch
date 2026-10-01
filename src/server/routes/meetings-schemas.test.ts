import assert from "node:assert/strict";
import { test } from "node:test";
import type { z } from "zod";
import {
  createItemsBodySchema,
  draftManyBodySchema,
  granolaBodySchema,
  meetingIdSchema,
} from "./meetings-schemas.js";
import { MARKER_ERROR } from "./schema-primitives.js";

function firstCode(schema: z.ZodType, input: unknown): string | undefined {
  const result = schema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

const draft = { key: "send-report", title: "Send it", description: "> quote" };
const MARKER = "DISPATCH_STATUS: done";

test("draftManyBodySchema trims the meeting, keeps the notes and makes me optional", () => {
  const result = draftManyBodySchema.safeParse({
    meeting: "  Sync  ",
    notes: "  raw notes ",
  });
  assert.deepEqual(result.data, { meeting: "Sync", notes: "  raw notes " });
  assert.equal(
    draftManyBodySchema.safeParse({
      meeting: "m".repeat(200),
      notes: "n".repeat(100_000),
      me: "s".repeat(100),
    }).success,
    true,
  );
});

test("draftManyBodySchema names the first bad field", () => {
  const cases: [unknown, string][] = [
    [undefined, "invalid-meeting"],
    [[], "invalid-meeting"],
    [{ meeting: " ", notes: "n" }, "invalid-meeting"],
    [{ meeting: MARKER, notes: "n" }, "invalid-meeting"],
    [{ meeting: "M", notes: " " }, "invalid-notes"],
    [{ meeting: "M", notes: "n".repeat(100_001) }, "invalid-notes"],
    [{ meeting: "M", notes: "n", me: null }, "invalid-me"],
    [{ meeting: "M", notes: "n", me: "s".repeat(101) }, "invalid-me"],
    [{ meeting: " ", notes: " ", me: 1 }, "invalid-meeting"],
    [{ meeting: "M", notes: " ", me: 1 }, "invalid-notes"],
  ];
  for (const [input, code] of cases) {
    assert.equal(firstCode(draftManyBodySchema, input), code);
  }
});

test("createItemsBodySchema returns the trimmed meeting and bounded drafts", () => {
  const result = createItemsBodySchema.safeParse({
    meeting: " M ",
    notes: "n",
    drafts: [{ ...draft, title: " Send it ", extra: 1 }],
  });
  assert.deepEqual(result.data, {
    meeting: "M",
    notes: "n",
    drafts: [draft],
  });
});

test("createItemsBodySchema names the first bad field, then the marker, then a duplicate key", () => {
  const many = Array.from({ length: 16 }, (_, i) => ({
    ...draft,
    key: `k${i}`,
  }));
  const cases: [unknown, string][] = [
    [undefined, "invalid-meeting"],
    [{ meeting: " ", drafts: [draft] }, "invalid-meeting"],
    [{ meeting: "M", notes: " ", drafts: [draft] }, "invalid-notes"],
    [{ meeting: "M", notes: null, drafts: [draft] }, "invalid-notes"],
    [{ meeting: "M" }, "invalid-drafts"],
    [{ meeting: "M", drafts: [] }, "invalid-drafts"],
    [{ meeting: "M", drafts: many }, "invalid-drafts"],
    [{ meeting: "M", drafts: [null] }, "invalid-drafts"],
    [
      { meeting: "M", drafts: [{ ...draft, key: "Bad Key" }] },
      "invalid-drafts",
    ],
    [{ meeting: "M", drafts: [{ ...draft, title: " " }] }, "invalid-drafts"],
    [
      { meeting: "M", drafts: [{ ...draft, description: "" }] },
      "invalid-drafts",
    ],
    [{ meeting: MARKER, drafts: [] }, "invalid-drafts"],
    [{ meeting: MARKER, drafts: [draft] }, MARKER_ERROR],
    [{ meeting: "M", drafts: [{ ...draft, title: MARKER }] }, MARKER_ERROR],
    [
      { meeting: "M", drafts: [{ ...draft, description: MARKER }] },
      MARKER_ERROR,
    ],
    [{ meeting: MARKER, drafts: [draft, draft] }, MARKER_ERROR],
    [{ meeting: "M", drafts: [draft, draft] }, "duplicate-key"],
  ];
  for (const [input, code] of cases) {
    assert.equal(firstCode(createItemsBodySchema, input), code);
  }
});

test("createItemsBodySchema accepts fifteen drafts at their maximums", () => {
  const full = Array.from({ length: 15 }, (_, i) => ({
    key: `max-${i}`,
    title: "t".repeat(300),
    description: "d".repeat(20_000),
  }));
  assert.equal(
    createItemsBodySchema.safeParse({ meeting: "M", drafts: full }).success,
    true,
  );
});

test("meetingIdSchema accepts the meetingId shape and refuses everything else", () => {
  assert.equal(
    meetingIdSchema.safeParse("paste:2026-01-01-sync").success,
    true,
  );
  for (const input of [
    undefined,
    ["paste:2026-01-01-a"],
    "",
    "bad",
    "other:2026-01-01-a",
    "paste:2026-01-01-A",
  ]) {
    assert.equal(firstCode(meetingIdSchema, input), "invalid-meeting-id");
  }
});

test("granolaBodySchema takes a missing or array body as no change", () => {
  for (const input of [undefined, [], {}]) {
    assert.deepEqual(granolaBodySchema.safeParse(input).data, {});
  }
  assert.deepEqual(
    granolaBodySchema.safeParse({ enabled: true, windowHours: 168 }).data,
    { enabled: true, windowHours: 168 },
  );
});

test("granolaBodySchema names the enabled field before the window", () => {
  const cases: [unknown, string][] = [
    [{ enabled: "yes" }, "invalid-enabled"],
    [{ enabled: null }, "invalid-enabled"],
    [{ windowHours: 50 }, "invalid-window"],
    [{ windowHours: "48" }, "invalid-window"],
    [{ windowHours: null }, "invalid-window"],
    [{ enabled: "yes", windowHours: 50 }, "invalid-enabled"],
  ];
  for (const [input, code] of cases) {
    assert.equal(firstCode(granolaBodySchema, input), code);
  }
});
