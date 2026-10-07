import test from "node:test";
import assert from "node:assert/strict";
import type { ClaudeUsageWindow } from "../../../shared/types.js";
import {
  CREDITS_OPTION,
  continueActionFor,
  parseLimitSurface,
  planLimitKeys,
} from "./limit-surface.js";

const STOP = "Stop and wait for limit to reset";
const WAIT = "Wait here, then continue automatically at 10:40am";
const LOWER = "Continue now at lower priority";
const CREDITS = "Switch to usage credits";
const FUNDS = "Add funds to continue with usage credits";
const ADMIN = "Ask your admin for more usage";
const UPGRADE = "Upgrade your plan";
const ALL = [STOP, WAIT, LOWER, CREDITS, FUNDS, ADMIN, UPGRADE];

/** Draw the options menu the way the fake REPL does, pointer on row `cursor`. */
function menu(options: string[], cursor = 0, title = true): string {
  const rows = options.map(
    (o, i) => ` ${i === cursor ? "❯" : " "} ${i + 1}. ${o}`,
  );
  return [...(title ? ["What do you want to do?", ""] : []), ...rows].join(
    "\n",
  );
}

/** Every ordering of `items`. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((head, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [
      head,
      ...rest,
    ]),
  );
}

/** The row Enter lands on after the planned arrows, or `null` when no key is planned. */
function selected(options: string[], cursor: number): string | null {
  const surface = parseLimitSurface(menu(options, cursor));
  assert.ok(surface?.kind === "b");
  const keys = planLimitKeys(surface);
  if (keys === null) return null;
  assert.equal(keys.at(-1), "Enter");
  assert.equal(keys.filter((k) => k === "Enter").length, 1);
  let at = cursor;
  for (const k of keys.slice(0, -1)) at += k === "Down" ? 1 : -1;
  return options[at];
}

void test("surface (a) in each form the CLI prints", () => {
  for (const pane of [
    "Usage limit reached · continuing automatically at 10:40am · esc to cancel",
    "Usage limit reached again · continuing automatically shortly · esc to cancel",
    "Continuing automatically at 10:40am · esc to cancel",
    "> \n? for shortcuts\nUSAGE LIMIT REACHED · CONTINUING AUTOMATICALLY SHORTLY · ESC TO CANCEL",
  ]) {
    assert.deepEqual(parseLimitSurface(pane), { kind: "a" }, pane);
    assert.deepEqual(planLimitKeys({ kind: "a" }), ["Escape"]);
  }
  assert.equal(parseLimitSurface("continuing automatically"), null);
  assert.equal(
    parseLimitSurface(
      "Automatic continue cancelled · /rate-limit-options to re-arm\n? for shortcuts",
    ),
    null,
  );
});

void test("surface (b) with the stop option first, in the middle and last", () => {
  const cases: [string[], number, string[]][] = [
    [[STOP, WAIT, CREDITS, UPGRADE], 0, ["Enter"]],
    [[STOP, WAIT, CREDITS, UPGRADE], 3, ["Up", "Up", "Up", "Enter"]],
    [[CREDITS, STOP, UPGRADE], 0, ["Down", "Enter"]],
    [[CREDITS, STOP, UPGRADE], 2, ["Up", "Enter"]],
    [[CREDITS, UPGRADE, WAIT, STOP], 0, ["Down", "Down", "Down", "Enter"]],
    [[CREDITS, UPGRADE, WAIT, STOP], 3, ["Enter"]],
  ];
  for (const [options, cursor, keys] of cases) {
    const surface = parseLimitSurface(menu(options, cursor));
    assert.deepEqual(surface, { kind: "b", options, cursor });
    assert.deepEqual(planLimitKeys(surface), keys, options.join(" / "));
  }
});

void test("the b-credits-first order moves past the paid rows to the stop row", () => {
  const options = [CREDITS, UPGRADE, STOP, WAIT];
  const surface = parseLimitSurface(menu(options));
  assert.deepEqual(surface, { kind: "b", options, cursor: 0 });
  assert.deepEqual(planLimitKeys(surface), ["Down", "Down", "Enter"]);
});

void test("with no stop option the wait option is chosen, and with neither no key is planned", () => {
  const waitOnly = parseLimitSurface(menu([CREDITS, WAIT, UPGRADE], 2));
  assert.deepEqual(planLimitKeys(waitOnly!), ["Up", "Enter"]);
  const noStop = parseLimitSurface(menu([CREDITS, UPGRADE]));
  assert.deepEqual(noStop, {
    kind: "b",
    options: [CREDITS, UPGRADE],
    cursor: 0,
  });
  assert.equal(planLimitKeys(noStop), null);
  assert.equal(
    planLimitKeys(parseLimitSurface(menu([LOWER, ADMIN, FUNDS], 1))!),
    null,
  );
});

void test("a menu with no pointer row plans no key", () => {
  const surface = parseLimitSurface(menu([CREDITS, STOP], -1));
  assert.deepEqual(surface, {
    kind: "b",
    options: [CREDITS, STOP],
    cursor: -1,
  });
  assert.equal(planLimitKeys(surface), null);
});

void test("the usage-based Stop label is the stop option", () => {
  assert.deepEqual(
    planLimitKeys(parseLimitSurface(menu([CREDITS, "Stop", WAIT]))!),
    ["Down", "Enter"],
  );
});

void test("a numbered list above the menu and a box border do not shift the rows", () => {
  const pane = [
    "Plan:",
    "1. Fix the bug",
    "2. Stop and wait for review",
    "",
    "╭──────────────────────────────────────────╮",
    "│ What do you want to do?                  │",
    "│                                          │",
    "│ ❯ 1. Switch to usage credits             │",
    "│   2. Stop and wait for limit to reset    │",
    "╰──────────────────────────────────────────╯",
  ].join("\n");
  assert.deepEqual(parseLimitSurface(pane), {
    kind: "b",
    options: [CREDITS, STOP],
    cursor: 0,
  });
  const untitled = menu([CREDITS, WAIT], 0, false);
  assert.deepEqual(parseLimitSurface(`1. Fix the bug\n${untitled}`), {
    kind: "b",
    options: [CREDITS, WAIT],
    cursor: 0,
  });
});

void test("unrelated panes and normal output that mentions usage credits are not a surface", () => {
  for (const pane of [
    "",
    "> \n? for shortcuts",
    "* Working... (esc to interrupt)",
    "The advisor bills to usage credits, which need to be set up first.\n> \n? for shortcuts",
    "What now?\n ❯ 1. Switch to usage credits\n   2. Upgrade your plan",
    "Steps:\n1. Stop and wait for the build\n2. Upgrade your plan later",
    "What do you want to do?\n ❯ 1. Run the tests\n   2. Open the file",
  ]) {
    assert.equal(parseLimitSurface(pane), null, pane);
  }
});

void test("over every ordering and cursor of the real options, Enter never lands on a credits row", () => {
  let checked = 0;
  for (const options of permutations(ALL)) {
    for (let cursor = 0; cursor < options.length; cursor++) {
      const row = selected(options, cursor);
      assert.equal(row, STOP);
      assert.equal(CREDITS_OPTION.test(row), false);
      checked++;
    }
  }
  for (const options of permutations(ALL.filter((o) => o !== STOP))) {
    for (let cursor = 0; cursor < options.length; cursor++) {
      assert.equal(selected(options, cursor), WAIT);
      checked++;
    }
  }
  for (const options of permutations(
    ALL.filter((o) => o !== STOP && o !== WAIT),
  )) {
    for (let cursor = 0; cursor < options.length; cursor++) {
      assert.equal(selected(options, cursor), null);
      checked++;
    }
  }
  assert.equal(checked, 5040 * 7 + 720 * 6 + 120 * 5);
});

void test("the credits pattern matches every paid row and no stop or wait row", () => {
  for (const paid of [
    CREDITS,
    FUNDS,
    UPGRADE,
    "Use extra usage",
    "Pay now",
    "Switch to usage",
    "Switch to usage billing",
  ]) {
    assert.equal(CREDITS_OPTION.test(paid), true, paid);
  }
  for (const free of [STOP, "Stop", WAIT, LOWER, ADMIN]) {
    assert.equal(CREDITS_OPTION.test(free), false, free);
  }
});

const windowAt = (percent: number): ClaudeUsageWindow => ({
  kind: "session",
  label: "Session",
  percent,
  resetsAt: null,
  isActive: true,
  periodStart: null,
  periodEnd: null,
});

void test("allowance: below 100 is available, any bucket at 100 is none, no windows is unknown", () => {
  const usage = (windows: ClaudeUsageWindow[]) => ({
    status: "ok" as const,
    windows,
    fetchedAt: null,
  });
  assert.equal(
    continueActionFor(usage([windowAt(10), windowAt(99.9)])),
    "available",
  );
  assert.equal(
    continueActionFor(usage([windowAt(10), windowAt(100)])),
    undefined,
  );
  assert.equal(continueActionFor(usage([windowAt(120)])), undefined);
  assert.equal(continueActionFor(usage([])), "usage-unknown");
  assert.equal(
    continueActionFor({ status: "unavailable", windows: [], fetchedAt: null }),
    "usage-unknown",
  );
});
