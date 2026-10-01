import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataInk } from "./data-ink.js";

const INSTRUMENT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/contrast-113.mjs",
);

void test("data ink mixes 35 percent of the colour with the text colour", () => {
  assert.equal(
    dataInk("var(--col-done)"),
    "color-mix(in srgb, var(--col-done) 35%, var(--text))",
  );
});

void test("the contrast instrument measures the share that data ink ships", () => {
  const share = /DATA_INK_SHARE = ([\d.]+);/.exec(
    readFileSync(INSTRUMENT, "utf8"),
  );
  const percent = / (\d+)%/.exec(dataInk("var(--col-done)"));
  assert.ok(share !== null && percent !== null);
  assert.equal(Math.round(Number(share[1]) * 100), Number(percent[1]));
});
