import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveShortcut,
  TICKETS_BINDINGS,
  type ShortcutBinding,
  type ShortcutEvent,
} from "./shortcuts.js";

function bindings(): ShortcutBinding[] {
  return TICKETS_BINDINGS.map((entry) => ({ ...entry, run: () => {} }));
}

function event(overrides: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return {
    key: "j",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: null,
    ...overrides,
  };
}

const scope = { modalOpen: false, menuOpen: false, inScope: true };

test("j, k, Enter, e and o each resolve a binding", () => {
  for (const key of ["j", "k", "Enter", "e", "o"]) {
    const binding = resolveShortcut(event({ key }), bindings(), scope);
    assert.equal(binding?.key, key);
  }
});

test("an INPUT target resolves nothing", () => {
  const binding = resolveShortcut(
    event({ target: { tagName: "INPUT" } }),
    bindings(),
    scope,
  );
  assert.equal(binding, null);
});

test("each held modifier resolves nothing", () => {
  assert.equal(
    resolveShortcut(event({ metaKey: true }), bindings(), scope),
    null,
  );
  assert.equal(
    resolveShortcut(event({ ctrlKey: true }), bindings(), scope),
    null,
  );
  assert.equal(
    resolveShortcut(event({ altKey: true }), bindings(), scope),
    null,
  );
});

test("out of scope resolves nothing", () => {
  const binding = resolveShortcut(event(), bindings(), {
    ...scope,
    inScope: false,
  });
  assert.equal(binding, null);
});

test("the table has no duplicate keys", () => {
  const keys = TICKETS_BINDINGS.map((entry) => entry.key);
  assert.equal(new Set(keys).size, keys.length);
});
