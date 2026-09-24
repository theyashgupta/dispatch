import { test } from "node:test";
import assert from "node:assert/strict";
import { CHIP_TONES } from "./Chip.js";

const TINTED = ["accent", "success", "warning", "danger"] as const;

test("every tone colors its text through a token reference", () => {
  for (const tone of Object.values(CHIP_TONES)) {
    assert.match(String(tone.color), /^var\(--[a-z-]+\)$/);
  }
});

test("tinted tones mix 16 percent of a token over the card surface", () => {
  for (const id of TINTED) {
    assert.match(
      String(CHIP_TONES[id].background),
      /^color-mix\(in srgb, var\(--[a-z-]+\) 16%, var\(--surface-card\)\)$/,
    );
    assert.equal(CHIP_TONES[id].border, undefined);
  }
});

test("the neutral tone is outlined with no fill", () => {
  assert.equal(CHIP_TONES.neutral.background, undefined);
  assert.equal(CHIP_TONES.neutral.border, "1px solid var(--border)");
  assert.equal(CHIP_TONES.neutral.color, "var(--text-muted)");
});

test("the danger tone tints from the fill role and reads in the text role", () => {
  assert.equal(CHIP_TONES.danger.color, "var(--destructive-text)");
  assert.match(
    String(CHIP_TONES.danger.background),
    /var\(--destructive\) 16%/,
  );
});

test("the tone table holds exactly five tones", () => {
  assert.deepEqual(Object.keys(CHIP_TONES).sort(), [
    "accent",
    "danger",
    "neutral",
    "success",
    "warning",
  ]);
});
