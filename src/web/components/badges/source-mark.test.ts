import { test } from "node:test";
import assert from "node:assert/strict";
import { Bot, Tag } from "lucide-react";
import { CalendarMark } from "@/components/icons/brands/CalendarMark";
import { GitHubMark } from "@/components/icons/brands/GitHubMark";
import { GranolaMark } from "@/components/icons/brands/GranolaMark";
import { LinearMark } from "@/components/icons/brands/LinearMark";
import { SentryMark } from "@/components/icons/brands/SentryMark";
import { SlackMark } from "@/components/icons/brands/SlackMark";
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
