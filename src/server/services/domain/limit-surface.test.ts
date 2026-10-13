import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CREDITS_OPTION,
  inputLineAt,
  limitChoice,
  parseLimitSurface,
  planLimitKeys,
} from "./limit-surface.js";

const PANES = new URL("../../test-support/fixtures/panes/", import.meta.url);
const STOP = "Stop and wait for limit to reset";
const WAIT = "Wait here, then continue automatically at 8:30am";
const CREDITS = "Switch to usage credits";
const UPGRADE = "Upgrade your plan";

function pane(name: string): string {
  return readFileSync(new URL(name, PANES), "utf8");
}

/** Render a titled limit menu with the pointer on row `cursor`. */
function menu(rows: readonly string[], cursor: number): string {
  const body = rows.map(
    (r, i) => `  ${i === cursor ? "❯" : " "} ${i + 1}. ${r}`,
  );
  return [
    "  What do you want to do?",
    ...body,
    "  Enter to confirm · Esc to cancel",
  ].join("\n");
}

function permutations<T>(rows: readonly T[]): T[][] {
  if (rows.length <= 1) return [[...rows]];
  return rows.flatMap((r, i) =>
    permutations([...rows.slice(0, i), ...rows.slice(i + 1)]).map((p) => [
      r,
      ...p,
    ]),
  );
}

/** Replay planned keys from `cursor` and return the row index under the cursor at Enter. */
function selectedRow(keys: readonly string[], cursor: number): number | null {
  let at = cursor;
  for (const key of keys) {
    if (key === "Down") at++;
    else if (key === "Up") at--;
    else if (key === "Enter") return at;
  }
  return null;
}

void test("the recorded limit menus parse with three rows and the pointer on row 1", () => {
  for (const file of ["limit-menu.txt", "limit-menu-2.txt"]) {
    const surface = parseLimitSurface(pane(file));
    assert.equal(surface?.kind, "b", file);
    if (surface?.kind !== "b") continue;
    assert.equal(surface.options.length, 3);
    assert.equal(surface.cursor, 0);
    assert.match(surface.options[2], CREDITS_OPTION);
  }
});

void test("the recorded auto continue notice is surface a; a cancelled one is no surface", () => {
  assert.deepEqual(parseLimitSurface(pane("auto-continue.txt")), { kind: "a" });
  assert.equal(parseLimitSurface(pane("auto-continue-2.txt")), null);
  assert.deepEqual(planLimitKeys({ kind: "a" }), ["Escape"]);
});

void test("the live shortly notice below the input line is surface a, under a persisted notice above it", () => {
  assert.deepEqual(parseLimitSurface(pane("auto-continue-3.txt")), {
    kind: "a",
  });
});

void test("a permission dialog footer under prose that says continuing shortly is no surface", () => {
  assert.equal(
    parseLimitSurface(
      "❯ fix it\n⏺ Continuing shortly with the edit.\n Do you want to proceed?\n ❯ 1. Yes\n   2. No\n Esc to cancel · Tab to amend",
    ),
    null,
  );
});

void test("a surface left above the input line is scrollback, not a surface", () => {
  assert.equal(parseLimitSurface(pane("limit-cancelled.txt")), null);
  const linesAboveInput = pane("limit-cancelled.txt").split("\n").slice(0, 2);
  assert.deepEqual(parseLimitSurface(linesAboveInput.join("\n")), {
    kind: "a",
  });
  assert.equal(
    parseLimitSurface(`${menu([STOP, WAIT, CREDITS], 0)}\n❯ \n`),
    null,
  );
});

void test("a menu below a rate-limit-options echo line and a notice below an input line are surfaces", () => {
  assert.deepEqual(
    parseLimitSurface(
      `❯ /rate-limit-options\n${menu([STOP, WAIT, CREDITS], 1)}`,
    ),
    { kind: "b", options: [STOP, WAIT, CREDITS], cursor: 1 },
  );
  assert.deepEqual(
    parseLimitSurface(
      "❯ \nUsage limit reached · continuing automatically at 10:40am · esc to cancel",
    ),
    { kind: "a" },
  );
});

void test("the input line skips numbered menu rows and the permission Deny row", () => {
  assert.equal(inputLineAt(["❯ ", "❯ 1. Yes", "❯ Deny"]), 0);
  assert.equal(inputLineAt(["❯ 1. Yes", "  2. No"]), -1);
});

void test("a pane that only mentions usage credits is not a surface", () => {
  for (const text of [
    "⏺ I will not switch to usage credits or upgrade your plan.\n❯ ",
    `1. ${CREDITS}\n2. ${UPGRADE}`,
    `⏺ Options were:\n  1. ${CREDITS}\n  2. Buy extra usage`,
  ]) {
    assert.equal(parseLimitSurface(text), null, text);
  }
});

void test("limitChoice never returns a credits row for any order or cursor", () => {
  let cases = 0;
  for (const rows of [
    ...permutations([STOP, WAIT, CREDITS, UPGRADE]),
    ...permutations([WAIT, CREDITS, UPGRADE]),
    ...permutations([CREDITS, UPGRADE]),
  ]) {
    for (let cursor = 0; cursor < rows.length; cursor++) {
      const surface = parseLimitSurface(menu(rows, cursor));
      assert.equal(surface?.kind, "b");
      if (surface?.kind !== "b") continue;
      const index = limitChoice(surface.options);
      if (index !== null)
        assert.doesNotMatch(surface.options[index], CREDITS_OPTION);
      const keys = planLimitKeys(surface);
      if (keys !== null) {
        const row = selectedRow(keys, cursor);
        assert.notEqual(row, null);
        assert.doesNotMatch(surface.options[row!], CREDITS_OPTION);
      }
      cases++;
    }
  }
  assert.equal(cases, 4 * 24 + 3 * 6 + 2 * 2);
});

void test("the plan reaches the stop row from every cursor row, else the wait row", () => {
  for (const rows of permutations([STOP, WAIT, CREDITS])) {
    for (let cursor = 0; cursor < rows.length; cursor++) {
      const surface = parseLimitSurface(menu(rows, cursor));
      const keys = surface && planLimitKeys(surface);
      assert.ok(keys);
      assert.equal(rows[selectedRow(keys, cursor)!], STOP);
    }
  }
  for (const rows of permutations([WAIT, CREDITS])) {
    for (let cursor = 0; cursor < rows.length; cursor++) {
      const surface = parseLimitSurface(menu(rows, cursor));
      const keys = surface && planLimitKeys(surface);
      assert.ok(keys);
      assert.equal(rows[selectedRow(keys, cursor)!], WAIT);
    }
  }
});

void test("planLimitKeys sends no key for a credits only menu or an unknown cursor", () => {
  const creditsOnly = parseLimitSurface(menu([CREDITS, UPGRADE], 0));
  assert.ok(creditsOnly);
  assert.equal(planLimitKeys(creditsOnly), null);
  const noPointer = parseLimitSurface(menu([STOP, WAIT, CREDITS], -1));
  assert.equal(noPointer?.kind, "b");
  assert.equal(planLimitKeys(noPointer), null);
  assert.equal(
    planLimitKeys({ kind: "b", options: [STOP, WAIT, CREDITS], cursor: 7 }),
    null,
  );
});

void test("a stop row that also names a paid option is refused", () => {
  assert.equal(
    limitChoice(["Stop and wait, then switch to usage billing"]),
    null,
  );
  assert.equal(limitChoice(["Wait here and pay for extra usage"]), null);
  assert.equal(limitChoice([CREDITS, UPGRADE, "Buy more funds"]), null);
});
