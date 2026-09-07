import assert from "node:assert/strict";
import { test } from "node:test";
import { FONT_FAMILY } from "./nerd-font-mono.js";
import {
  DEFAULT_TERMINAL_APPEARANCE,
  TERMINAL_FONT_FAMILIES,
  terminalFontStack,
  toTerminalTheme,
  validateTerminalAppearance,
} from "./terminal-appearance.js";

test("shipped defaults are the solid theme", () => {
  assert.deepEqual(DEFAULT_TERMINAL_APPEARANCE, {
    background: "#111111",
    foreground: "#e8e9ea",
    cursor: "#e8e9ea",
    fontFamily: FONT_FAMILY,
    fontSize: 14,
  });
});

test("the font allowlist is exactly the seven offered families", () => {
  assert.deepEqual(TERMINAL_FONT_FAMILIES, [
    FONT_FAMILY,
    "Menlo",
    "Monaco",
    "SF Mono",
    "Fira Code",
    "JetBrains Mono",
    "monospace",
  ]);
});

test("defaults validate and round-trip unchanged", () => {
  const result = validateTerminalAppearance(DEFAULT_TERMINAL_APPEARANCE);
  assert.deepEqual(result, { ok: true, value: DEFAULT_TERMINAL_APPEARANCE });
});

test("uppercase hex is normalized to lowercase", () => {
  const result = validateTerminalAppearance({
    ...DEFAULT_TERMINAL_APPEARANCE,
    background: "#ABCDEF",
  });
  assert.equal(result.ok && result.value.background, "#abcdef");
});

const rejections: Array<[string, Record<string, unknown>, string]> = [
  ["short hex", { background: "#12345" }, "background"],
  ["hex without hash", { foreground: "e8e9ea" }, "foreground"],
  ["named color", { cursor: "red" }, "cursor"],
  ["fontSize below floor", { fontSize: 7 }, "fontSize"],
  ["fontSize above ceiling", { fontSize: 33 }, "fontSize"],
  ["fractional fontSize", { fontSize: 12.5 }, "fontSize"],
  ["fontSize as string", { fontSize: "big" }, "fontSize"],
  ["font off the allowlist", { fontFamily: "Comic Sans" }, "fontFamily"],
  ["fontFamily as number", { fontFamily: 3 }, "fontFamily"],
];

for (const [name, patch, field] of rejections) {
  test(`rejects ${name} naming ${field}`, () => {
    const result = validateTerminalAppearance({
      ...DEFAULT_TERMINAL_APPEARANCE,
      ...patch,
    });
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.error : "", new RegExp(`^${field}`));
  });
}

for (const input of [null, "garbage", 42, [], undefined]) {
  test(`rejects non-object input ${JSON.stringify(input) ?? "undefined"}`, () => {
    assert.equal(validateTerminalAppearance(input).ok, false);
  });
}

test("font stack always ends with the bundled font then monospace", () => {
  assert.equal(
    terminalFontStack("Menlo"),
    `"Menlo", "${FONT_FAMILY}", monospace`,
  );
  assert.equal(terminalFontStack(FONT_FAMILY), `"${FONT_FAMILY}", monospace`);
  assert.equal(terminalFontStack("monospace"), `monospace, "${FONT_FAMILY}"`);
});

test("theme carries the fixed palette and the editable fields", () => {
  const theme = toTerminalTheme(DEFAULT_TERMINAL_APPEARANCE);
  assert.equal(theme.theme.background, "#111111");
  assert.equal(theme.theme.foreground, "#e8e9ea");
  assert.equal(theme.theme.cursor, "#e8e9ea");
  assert.equal(theme.theme.brightWhite, "#bac2de");
  assert.equal(theme.fontWeight, 600);
  assert.equal(theme.cursorStyle, "block");
  assert.equal(theme.cursorBlink, false);
});
