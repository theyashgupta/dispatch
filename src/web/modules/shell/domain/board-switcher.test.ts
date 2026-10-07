import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bindShortcuts,
  resolveShortcut,
  type ShortcutEvent,
} from "../../../../shared/shortcuts.js";
import type { BoardKey } from "../../../../shared/types.js";
import {
  attentionLabel,
  collapsedLabel,
  showSwitcher,
  switcherItems,
  switcherShortcuts,
} from "./board-switcher.js";

const LOCAL = "LOCAL" as BoardKey;
const ACME = "ACME" as BoardKey;
const OLD = "OLD" as BoardKey;

const boards = [
  { key: LOCAL, name: "Dispatch", archived: false },
  { key: OLD, name: "Old", archived: true },
  { key: ACME, name: "Acme", archived: false },
];

test("showSwitcher needs more than one active board", () => {
  assert.equal(showSwitcher(boards, false, LOCAL), true);
  assert.equal(showSwitcher(boards.slice(0, 2), false, LOCAL), false);
  assert.equal(showSwitcher(boards.slice(0, 1), false, LOCAL), false);
});

test("showSwitcher hides while the list has not loaded", () => {
  assert.equal(showSwitcher(undefined, false, ACME), false);
  assert.equal(showSwitcher(undefined, false, LOCAL), false);
});

test("showSwitcher with a failed list shows only for a board other than LOCAL", () => {
  assert.equal(showSwitcher(undefined, true, ACME), true);
  assert.equal(showSwitcher(undefined, true, LOCAL), false);
});

test("showSwitcher keeps the cached list when a refetch failed", () => {
  assert.equal(showSwitcher(boards, true, LOCAL), true);
  assert.equal(showSwitcher(boards.slice(0, 1), true, ACME), false);
});

test("switcherItems lists active boards in order with counts and the selected mark", () => {
  const counts = [
    { key: LOCAL, running: 0, openGroups: 0, attention: 2 },
    { key: ACME, running: 1, openGroups: 0, attention: 0 },
  ];
  assert.deepEqual(switcherItems(boards, counts, ACME), [
    { key: LOCAL, name: "Dispatch", attention: 2, selected: false },
    { key: ACME, name: "Acme", attention: 0, selected: true },
  ]);
});

test("switcherItems reads zero attention before the counts load", () => {
  assert.deepEqual(
    switcherItems(boards, undefined, LOCAL).map((item) => item.attention),
    [0, 0],
  );
});

test("collapsedLabel takes the first two letters of the key", () => {
  assert.equal(collapsedLabel(LOCAL), "LO");
  assert.equal(collapsedLabel(ACME), "AC");
});

test("attentionLabel names the count", () => {
  assert.equal(attentionLabel(3), "3 items need attention");
  assert.equal(attentionLabel(1), "1 item needs attention");
});

test("switcherShortcuts adds the Switch board row only while the switcher shows", () => {
  assert.deepEqual(
    switcherShortcuts(true).filter((row) => row.key === "b"),
    [{ key: "b", label: "Switch board" }],
  );
  assert.equal(
    switcherShortcuts(false).some((row) => row.key === "b"),
    false,
  );
});

function press(
  target: ShortcutEvent["target"],
  context: { modalOpen?: boolean; menuOpen?: boolean },
  show = true,
) {
  const bindings = bindShortcuts(switcherShortcuts(show), { b: () => {} });
  return resolveShortcut(
    { key: "b", metaKey: false, ctrlKey: false, altKey: false, target },
    bindings,
    { modalOpen: false, menuOpen: false, inScope: true, ...context },
  );
}

test("b fires with the switcher shown and nothing else open", () => {
  assert.equal(press({ tagName: "DIV" }, {})?.key, "b");
  assert.equal(press(null, {})?.key, "b");
});

test("b is inert in a text field", () => {
  assert.equal(press({ tagName: "INPUT" }, {}), null);
  assert.equal(press({ tagName: "TEXTAREA" }, {}), null);
  assert.equal(press({ tagName: "DIV", isContentEditable: true }, {}), null);
});

test("b is inert while a dialog is open", () => {
  assert.equal(press({ tagName: "DIV" }, { modalOpen: true }), null);
});

test("b is inert while a menu is open", () => {
  assert.equal(press({ tagName: "DIV" }, { menuOpen: true }), null);
});

test("b has no binding with one board", () => {
  assert.equal(press({ tagName: "DIV" }, {}, false), null);
});

test("b is inert with a modifier held", () => {
  const bindings = bindShortcuts(switcherShortcuts(true), { b: () => {} });
  const context = { modalOpen: false, menuOpen: false, inScope: true };
  const base = { key: "b", target: null, altKey: false };
  assert.equal(
    resolveShortcut(
      { ...base, metaKey: true, ctrlKey: false },
      bindings,
      context,
    ),
    null,
  );
  assert.equal(
    resolveShortcut(
      { ...base, metaKey: false, ctrlKey: true },
      bindings,
      context,
    ),
    null,
  );
});
