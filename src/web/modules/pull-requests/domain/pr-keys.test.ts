import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bindShortcuts,
  isEditableRole,
  resolveShortcut,
  type ShortcutEvent,
} from "../../../../shared/shortcuts.js";
import { PR_SHORTCUTS, nextCursorKey } from "./pr-keys.js";

const OPEN = { modalOpen: false, menuOpen: false, inScope: true };

function press(key: string, over: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: null,
    ...over,
  };
}

function resolve(event: ShortcutEvent, context = OPEN) {
  const runs = Object.fromEntries(
    PR_SHORTCUTS.map((entry) => [entry.key, () => {}]),
  );
  return resolveShortcut(event, bindShortcuts(PR_SHORTCUTS, runs), context)
    ?.key;
}

test("the pull request table resolves j, k and Enter and nothing else", () => {
  for (const key of ["j", "k", "Enter"]) {
    assert.equal(resolve(press(key)), key);
  }
  assert.equal(resolve(press("e")), undefined);
  assert.equal(resolve(press("o")), undefined);
});

test("j does nothing while a dialog is open", () => {
  assert.equal(resolve(press("j"), { ...OPEN, modalOpen: true }), undefined);
});

test("j does nothing when typing in a field", () => {
  assert.equal(
    resolve(press("j", { target: { tagName: "INPUT" } })),
    undefined,
  );
});

test("j does nothing with a modifier held", () => {
  assert.equal(resolve(press("j", { metaKey: true })), undefined);
});

test("a combobox or listbox target counts as editable", () => {
  const withRole = (role: string) => ({
    tagName: "BUTTON",
    getAttribute: (name: string) => (name === "role" ? role : null),
  });
  assert.equal(isEditableRole(withRole("combobox")), true);
  assert.equal(isEditableRole(withRole("listbox")), true);
  assert.equal(isEditableRole(withRole("button")), false);
});

const KEYS = ["a", "b", "c", "d", "e"];
const all = new Set(KEYS);

test("nextCursorKey returns null when no key is reachable", () => {
  assert.equal(nextCursorKey(KEYS, new Set(), "b", 1), null);
  assert.equal(nextCursorKey(KEYS, new Set(), null, -1), null);
  assert.equal(nextCursorKey([], new Set(), null, 1), null);
});

test("nextCursorKey starts on the first reachable key without a cursor", () => {
  assert.equal(nextCursorKey(KEYS, all, null, 1), "a");
  assert.equal(nextCursorKey(KEYS, all, null, -1), "a");
  assert.equal(nextCursorKey(KEYS, new Set(["c", "d"]), null, 1), "c");
});

test("nextCursorKey moves one reachable step from a visible cursor", () => {
  assert.equal(nextCursorKey(KEYS, all, "c", 1), "d");
  assert.equal(nextCursorKey(KEYS, all, "c", -1), "b");
  assert.equal(nextCursorKey(KEYS, new Set(["a", "c", "e"]), "c", 1), "e");
  assert.equal(nextCursorKey(KEYS, new Set(["a", "c", "e"]), "c", -1), "a");
});

test("nextCursorKey clamps at both ends", () => {
  assert.equal(nextCursorKey(KEYS, all, "e", 1), "e");
  assert.equal(nextCursorKey(KEYS, all, "a", -1), "a");
});

test("nextCursorKey takes the nearest reachable key from a hidden cursor", () => {
  const reachable = new Set(["a", "b", "d", "e"]);
  assert.equal(nextCursorKey(KEYS, reachable, "c", 1), "d");
  assert.equal(nextCursorKey(KEYS, reachable, "c", -1), "b");
});

test("nextCursorKey lands on the last key for j when nothing lies after a hidden cursor", () => {
  assert.equal(nextCursorKey(KEYS, new Set(["a", "b"]), "d", 1), "b");
});

test("nextCursorKey lands on the first key for k when nothing lies before a hidden cursor", () => {
  assert.equal(nextCursorKey(KEYS, new Set(["d", "e"]), "b", -1), "d");
});

test("nextCursorKey falls back to the first key for a cursor missing from the list", () => {
  assert.equal(nextCursorKey(KEYS, all, "zz", 1), "a");
});
