import test from "node:test";
import assert from "node:assert/strict";
import { fontOptionLabel } from "./terminal-fonts.js";

void test("fontOptionLabel suffixes only the fonts that are not installed", () => {
  const installed = new Set(["Menlo", "monospace"]);
  const labels = { Menlo: "Menlo", monospace: "System monospace" };
  assert.equal(fontOptionLabel("Menlo", installed, labels), "Menlo");
  assert.equal(
    fontOptionLabel("monospace", installed, labels),
    "System monospace",
  );
  assert.equal(
    fontOptionLabel("Fira Code", installed, labels),
    "Fira Code (not installed)",
  );
});
