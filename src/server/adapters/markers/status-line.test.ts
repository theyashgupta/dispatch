import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStatusLine } from "./status-line.js";

const dir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "status-line",
);
const fixture = (name: string) => fs.readFileSync(path.join(dir, name), "utf8");

const nullUsage = { fiveHourPercent: null, sevenDayPercent: null };

void test("full.txt yields every meter", () => {
  assert.deepEqual(parseStatusLine(fixture("full.txt")), {
    contextPercent: 38,
    model: "Opus 5.5",
    cost: 1.25,
    usage: { fiveHourPercent: 12, sevenDayPercent: 40 },
  });
});

void test("fast-1m.txt drops effort and FAST from the model", () => {
  assert.deepEqual(parseStatusLine(fixture("fast-1m.txt")), {
    contextPercent: 52,
    model: "Opus 5.5",
    cost: 2.1,
    usage: { fiveHourPercent: 71, sevenDayPercent: 93 },
  });
});

void test("no-effort-no-limits.txt leaves usage null", () => {
  assert.deepEqual(parseStatusLine(fixture("no-effort-no-limits.txt")), {
    contextPercent: 7,
    model: "Haiku 4.5",
    cost: 0.03,
    usage: nullUsage,
  });
});

void test("warming up keeps the model and nulls the rest", () => {
  assert.deepEqual(parseStatusLine(fixture("warming.txt")), {
    contextPercent: null,
    model: "Sonnet 5.5",
    cost: null,
    usage: nullUsage,
  });
});

void test("an indented live pane with lines below the rows parses", () => {
  assert.deepEqual(parseStatusLine(fixture("own-pane.txt")), {
    contextPercent: 21,
    model: "Opus 5.5",
    cost: 8.77,
    usage: { fiveHourPercent: 35, sevenDayPercent: 60 },
  });
});

void test("a pane with no status line returns null", () => {
  assert.equal(parseStatusLine("hello\nworld\n"), null);
  assert.equal(parseStatusLine(""), null);
});

void test("a quoted fake row above the real footer loses to the footer", () => {
  const quoted = "  Opus 5.5 · high  │  ██████████  99%  990k/1.0M\n";
  assert.deepEqual(
    parseStatusLine(`${quoted}some transcript\n${fixture("full.txt")}`),
    parseStatusLine(fixture("full.txt")),
  );
});

void test("a status-like line in another format returns null", () => {
  assert.equal(parseStatusLine("Model: Opus  ctx 40%  $3.00\n"), null);
});

void test("a context percent above 100 is clamped and four digits do not match", () => {
  const row = (percent: string) =>
    `Opus 5.5 · high  │  ██████████  ${percent}%  76k/200k\nGROUP-1  │  $1.25\n`;
  assert.equal(parseStatusLine(row("999"))?.contextPercent, 100);
  assert.equal(parseStatusLine(row("1000")), null);
});

void test("usage percents take at most three digits and a huge cost reads as null", () => {
  const pane = (second: string) =>
    `Opus 5.5 · high  │  ██████████  10%  76k/200k\n${second}\n`;
  assert.deepEqual(
    parseStatusLine(pane("GROUP-1  │  5h 1234%  │  7d 40%  │  $1234567890123"))
      ?.usage,
    { fiveHourPercent: null, sevenDayPercent: 40 },
  );
  assert.equal(parseStatusLine(pane("GROUP-1  │  $1234567890123"))?.cost, null);
  assert.equal(parseStatusLine(pane("GROUP-1  │  $12.50"))?.cost, 12.5);
});

void test("a long whitespace run in row 1 parses fast", () => {
  const startedAt = performance.now();
  assert.equal(parseStatusLine(`${" ".repeat(200_000)}x\n`), null);
  assert.equal(parseStatusLine(`Opus · ${" ".repeat(200_000)}x\n`), null);
  assert.ok(performance.now() - startedAt < 200);
});
