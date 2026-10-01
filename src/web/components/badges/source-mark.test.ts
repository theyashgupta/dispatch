import { test } from "node:test";
import assert from "node:assert/strict";
import { Bot, Tag } from "lucide-react";
import { CalendarMark } from "./brands/CalendarMark.js";
import { GitHubMark } from "./brands/GitHubMark.js";
import { GranolaMark } from "./brands/GranolaMark.js";
import { LinearMark } from "./brands/LinearMark.js";
import { SentryMark } from "./brands/SentryMark.js";
import { SlackMark } from "./brands/SlackMark.js";
import { SOURCE_ACCENT } from "./source-accent.js";
import { SOURCE_MARK, sourceMark } from "./source-mark.js";

void test("every accent entry has a mark and no mark lacks an accent", () => {
  assert.deepEqual(
    Object.keys(SOURCE_MARK).sort(),
    Object.keys(SOURCE_ACCENT).sort(),
  );
});

void test("each brand source maps to its own mark", () => {
  assert.deepEqual(
    ["github", "linear", "slack", "sentry", "meeting", "calendar"].map(
      (id) => SOURCE_MARK[id],
    ),
    [GitHubMark, LinearMark, SlackMark, SentryMark, GranolaMark, CalendarMark],
  );
});

void test("a brand id resolves to its mark and agent keeps the bot glyph", () => {
  for (const id of [
    "github",
    "linear",
    "slack",
    "sentry",
    "meeting",
    "calendar",
  ]) {
    assert.equal(sourceMark(id), SOURCE_MARK[id], id);
    assert.notEqual(sourceMark(id), Tag, id);
  }
  assert.equal(SOURCE_MARK.agent, Bot);
  assert.equal(sourceMark("agent"), Bot);
});

void test("an id outside the map gets the tag glyph, also a prototype key", () => {
  for (const id of ["zzz", "", "constructor", "__proto__", "toString"]) {
    assert.equal(Object.hasOwn(SOURCE_MARK, id), false, id);
    assert.equal(sourceMark(id), Tag, id);
  }
});
