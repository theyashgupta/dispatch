import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RESUME_TARGET_ERROR,
  RESUME_TARGET_LOADING,
  formatStartedAgo,
  resumeLine,
} from "./resume-target.js";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test("loading and error constants", () => {
  assert.equal(RESUME_TARGET_LOADING, "Checking the conversation");
  assert.equal(RESUME_TARGET_ERROR, "Could not read the conversation folder.");
});

test("formatStartedAgo covers each band and its edges", () => {
  assert.equal(formatStartedAgo(ago(0), NOW), "just now");
  assert.equal(formatStartedAgo(ago(59 * SEC), NOW), "just now");
  assert.equal(formatStartedAgo(ago(60 * SEC), NOW), "1 min ago");
  assert.equal(formatStartedAgo(ago(59 * MIN + 59 * SEC), NOW), "59 min ago");
  assert.equal(formatStartedAgo(ago(60 * MIN), NOW), "1 h ago");
  assert.equal(formatStartedAgo(ago(47 * HOUR + 59 * MIN), NOW), "47 h ago");
  assert.equal(formatStartedAgo(ago(48 * HOUR), NOW), "2 days ago");
  assert.equal(formatStartedAgo(ago(5 * DAY + HOUR), NOW), "5 days ago");
});

test("formatStartedAgo treats a future timestamp as just now", () => {
  assert.equal(formatStartedAgo(ago(-5 * MIN), NOW), "just now");
});

test("resume mode cuts the id to 8 characters and adds the age", () => {
  assert.deepEqual(
    resumeLine(
      {
        mode: "resume",
        sessionId: "0123456789abcdef",
        startedAt: ago(5 * MIN),
      },
      NOW,
    ),
    { text: "Resume: 01234567, started 5 min ago" },
  );
});

test("resume mode with a startedAt that does not parse shows only the id", () => {
  assert.equal(formatStartedAgo("garbage", NOW), "");
  assert.deepEqual(
    resumeLine(
      { mode: "resume", sessionId: "0123456789abcdef", startedAt: "garbage" },
      NOW,
    ),
    { text: "Resume: 01234567" },
  );
});

test("continue mode names the newest conversation", () => {
  assert.deepEqual(resumeLine({ mode: "continue" }, NOW), {
    text: "Resume: newest conversation in the workspace",
  });
});

test("newer-on-disk replacement adds its tooltip", () => {
  assert.deepEqual(
    resumeLine(
      {
        mode: "resume",
        sessionId: "aaaaaaaabbbb",
        startedAt: ago(2 * HOUR),
        replaced: { storedId: "1234567890", reason: "newer-on-disk" },
      },
      NOW,
    ),
    {
      text: "Resume: aaaaaaaa, started 2 h ago",
      tooltip:
        "Stored conversation 12345678 replaced: a newer conversation is on disk.",
    },
  );
});

test("no-conversation replacement adds its tooltip", () => {
  assert.deepEqual(
    resumeLine(
      {
        mode: "continue",
        replaced: { storedId: "1234567890", reason: "no-conversation" },
      },
      NOW,
    ),
    {
      text: "Resume: newest conversation in the workspace",
      tooltip:
        "Stored conversation 12345678 has no file on disk, so Resume continues the newest conversation.",
    },
  );
});
