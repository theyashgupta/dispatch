import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BOARD_SHORTCUTS,
  bindShortcuts,
  GLOBAL_SHORTCUTS,
  INBOX_SHORTCUTS,
  SESSIONS_SHORTCUTS,
  resolveShortcut,
  type ShortcutBinding,
  type ShortcutEvent,
} from "./shortcuts.js";

const bindings: ShortcutBinding[] = [
  { key: "j", label: "Next row", run: () => {} },
  { key: "Enter", label: "Open", run: () => {} },
];
const idle = { modalOpen: false, menuOpen: false, inScope: true };

function key(k: string, extra: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return {
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: { tagName: "DIV" },
    ...extra,
  };
}

test("j fires for a div target and Enter for a row; an unknown key resolves to nothing", () => {
  assert.equal(resolveShortcut(key("j"), bindings, idle)?.label, "Next row");
  assert.equal(resolveShortcut(key("Enter"), bindings, idle)?.label, "Open");
  assert.equal(resolveShortcut(key("x"), bindings, idle), null);
  assert.equal(
    resolveShortcut(key("j", { target: null }), bindings, idle)?.key,
    "j",
  );
});

test("j never fires inside an input, textarea, select or contentEditable", () => {
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
    assert.equal(
      resolveShortcut(key("j", { target: { tagName } }), bindings, idle),
      null,
      tagName,
    );
  }
  assert.equal(
    resolveShortcut(
      key("j", { target: { tagName: "DIV", isContentEditable: true } }),
      bindings,
      idle,
    ),
    null,
  );
});

test("no binding fires with Cmd, Ctrl or Alt held", () => {
  assert.equal(
    resolveShortcut(key("j", { metaKey: true }), bindings, idle),
    null,
  );
  assert.equal(
    resolveShortcut(key("j", { ctrlKey: true }), bindings, idle),
    null,
  );
  assert.equal(
    resolveShortcut(key("j", { altKey: true }), bindings, idle),
    null,
  );
});

test("nothing fires while a modal or a row menu is open", () => {
  assert.equal(
    resolveShortcut(key("j"), bindings, { ...idle, modalOpen: true }),
    null,
  );
  assert.equal(
    resolveShortcut(key("j"), bindings, { ...idle, menuOpen: true }),
    null,
  );
});

test("the Inbox shortcut table lists j, k, Enter, e, s, o and u once each", () => {
  assert.deepEqual(
    INBOX_SHORTCUTS.map((s) => s.key),
    ["j", "k", "Enter", "e", "s", "o", "u"],
  );
});

test("Enter and Space stay with a focused button or link while letters still fire, and nothing fires out of scope", () => {
  const button = { tagName: "BUTTON" };
  const link = { tagName: "A" };
  const roleButton = { tagName: "DIV", getAttribute: () => "button" };
  assert.equal(
    resolveShortcut(key("Enter", { target: button }), bindings, idle),
    null,
  );
  assert.equal(
    resolveShortcut(key(" ", { target: link }), bindings, idle),
    null,
  );
  assert.equal(
    resolveShortcut(key("Enter", { target: roleButton }), bindings, idle),
    null,
  );
  assert.equal(
    resolveShortcut(key("j", { target: button }), bindings, idle)?.key,
    "j",
  );
  assert.equal(
    resolveShortcut(
      key("Enter", { target: { tagName: "DIV" } }),
      bindings,
      idle,
    )?.key,
    "Enter",
  );
  assert.equal(
    resolveShortcut(key("j"), bindings, { ...idle, inScope: false }),
    null,
  );
});

test("the Sessions shortcut table lists j, k and Enter with labels", () => {
  assert.deepEqual(
    SESSIONS_SHORTCUTS.map((s) => [s.key, s.label]),
    [
      ["j", "Next session"],
      ["k", "Previous session"],
      ["Enter", "Open"],
    ],
  );
});

const meta: ShortcutBinding[] = [
  { key: "k", label: "Command palette", meta: true, run: () => {} },
  { key: "j", label: "Next card", run: () => {} },
  { key: "?", label: "Keyboard shortcuts", run: () => {} },
];

test("Cmd+K and Ctrl+K resolve the meta binding, even from an input; k alone does not", () => {
  assert.equal(
    resolveShortcut(key("k", { metaKey: true }), meta, idle)?.label,
    "Command palette",
  );
  assert.equal(
    resolveShortcut(
      key("K", { ctrlKey: true, target: { tagName: "INPUT" } }),
      meta,
      idle,
    )?.label,
    "Command palette",
  );
  assert.equal(resolveShortcut(key("k"), meta, idle), null);
  assert.equal(
    resolveShortcut(key("k", { metaKey: true, altKey: true }), meta, idle),
    null,
  );
  assert.equal(
    resolveShortcut(key("k", { metaKey: true }), meta, {
      ...idle,
      modalOpen: true,
    }),
    null,
  );
});

test("a plain binding never resolves with Cmd held, and ? resolves as typed with shift", () => {
  assert.equal(resolveShortcut(key("j", { metaKey: true }), meta, idle), null);
  assert.equal(
    resolveShortcut(key("?", { shiftKey: true }), meta, idle)?.label,
    "Keyboard shortcuts",
  );
});

test("the global and board tables list each key once, board keys 1 to 7 follow the columns, and ? is global only", () => {
  const global = GLOBAL_SHORTCUTS.map((b) => b.key);
  const board = BOARD_SHORTCUTS.map((b) => b.key);
  assert.deepEqual(global, ["k", "n", "?"]);
  assert.deepEqual(board, [
    "j",
    "k",
    "h",
    "l",
    "Enter",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
  ]);
  assert.equal(BOARD_SHORTCUTS[7]?.label, "Move to Needs Input");
  for (const table of [
    GLOBAL_SHORTCUTS,
    BOARD_SHORTCUTS,
    INBOX_SHORTCUTS,
    SESSIONS_SHORTCUTS,
  ]) {
    const keys = table.map((b) => `${b.meta === true ? "meta+" : ""}${b.key}`);
    assert.equal(new Set(keys).size, keys.length);
    for (const b of table) assert.ok(b.label.length > 0 && b.key.length > 0);
  }
});

test("bindShortcuts attaches runs by key, keeps meta and plain keys apart, and drops entries without a run", () => {
  const calls: string[] = [];
  const bound = bindShortcuts(
    [
      { key: "k", label: "Palette", meta: true },
      { key: "k", label: "Previous" },
      { key: "x", label: "Unbound" },
    ],
    { "meta+k": () => calls.push("palette"), k: () => calls.push("prev") },
  );
  assert.deepEqual(
    bound.map((b) => b.label),
    ["Palette", "Previous"],
  );
  for (const b of bound) b.run();
  assert.deepEqual(calls, ["palette", "prev"]);
});

test("Cmd+Shift+K does not open the palette", () => {
  assert.equal(
    resolveShortcut(key("k", { metaKey: true, shiftKey: true }), meta, idle),
    null,
  );
});
