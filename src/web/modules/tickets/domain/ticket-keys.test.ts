import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bindShortcuts,
  resolveShortcut,
  type ShortcutEvent,
} from "../../../../shared/shortcuts.js";
import { isEditableRole, TICKET_SHORTCUTS } from "./ticket-keys.js";

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
    TICKET_SHORTCUTS.map((entry) => [entry.key, () => {}]),
  );
  return resolveShortcut(event, bindShortcuts(TICKET_SHORTCUTS, runs), context)
    ?.key;
}

test("the ticket table resolves the five page keys and nothing else", () => {
  for (const key of ["j", "k", "Enter", "e", "o"]) {
    assert.equal(resolve(press(key)), key);
  }
  assert.equal(resolve(press("x")), undefined);
  assert.equal(resolve(press("J")), undefined);
});

test("the ticket table has no duplicate keys", () => {
  const keys = TICKET_SHORTCUTS.map((entry) => entry.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("the ticket keys are inert outside the page and while a dialog is open", () => {
  assert.equal(resolve(press("j"), { ...OPEN, modalOpen: true }), undefined);
  assert.equal(resolve(press("j"), { ...OPEN, inScope: false }), undefined);
});

test("the ticket keys ignore a key with a modifier held", () => {
  assert.equal(resolve(press("j", { metaKey: true })), undefined);
  assert.equal(resolve(press("j", { ctrlKey: true })), undefined);
  assert.equal(resolve(press("j", { altKey: true })), undefined);
});

test("the ticket keys ignore typing in a field", () => {
  assert.equal(
    resolve(press("j", { target: { tagName: "INPUT" } })),
    undefined,
  );
  assert.equal(
    resolve(press("e", { target: { isContentEditable: true } })),
    undefined,
  );
});

test("Enter stays with a focused button or link but j does not", () => {
  const button = { tagName: "BUTTON" };
  assert.equal(resolve(press("Enter", { target: button })), undefined);
  assert.equal(
    resolve(press("Enter", { target: { getAttribute: () => "link" } })),
    undefined,
  );
  assert.equal(resolve(press("j", { target: button })), "j");
});

test("isEditableRole flags a combobox or listbox and nothing else", () => {
  const withRole = (role: string | null) => ({
    tagName: "BUTTON",
    getAttribute: (name: string) => (name === "role" ? role : null),
  });
  assert.equal(isEditableRole(withRole("combobox")), true);
  assert.equal(isEditableRole(withRole("listbox")), true);
  assert.equal(isEditableRole(withRole("button")), false);
  assert.equal(isEditableRole(withRole(null)), false);
  assert.equal(isEditableRole({ tagName: "BUTTON" }), false);
  assert.equal(isEditableRole(null), false);
});
