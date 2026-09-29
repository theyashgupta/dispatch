import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIGHT_SELECTOR = ':root[data-theme="light"]';
const SIGNAL_NAME = /^--(?:prio|col|status|src)-[a-z-]+$/;
const SIGNAL_COUNT = 21;
const INSTRUMENT = join(WEB_ROOT, "../../scripts/contrast-113.mjs");
const THEME_NEUTRAL = [
  "--destructive",
  "--destructive-button-fill",
  "--on-accent",
  "--on-danger",
  "--qr-surface",
  "--prio-urgent",
  "--prio-low",
  "--col-in-progress",
  "--col-done",
  "--status-down",
];

/** Reads a stylesheet under the web root with its comments removed. */
function readCss(relativePath: string): string {
  return readFileSync(join(WEB_ROOT, relativePath), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
}

/**
 * Returns the text of the first rule that starts with this selector.
 *
 * @remarks A plain slice to the next closing brace, so the palette must stay the first `:root {`
 * rule of the file and a token block must hold no nested rule.
 */
function blockOf(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `no ${selector} rule in the stylesheet`);
  return css.slice(at, css.indexOf("}", at));
}

/** Lists the custom property declarations of a rule body in source order. */
function declarations(body: string): [name: string, value: string][] {
  return [...body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+)(?:;|$)/g)].map(
    (m): [string, string] => [m[1], m[2].trim()],
  );
}

const sourceFiles = readdirSync(WEB_ROOT, {
  recursive: true,
  encoding: "utf8",
})
  .filter(
    (name) => /\.(?:ts|tsx|css|html)$/.test(name) && !name.endsWith(".test.ts"),
  )
  .map((name) => join(WEB_ROOT, name));

const tokensCss = readCss("styles/tokens.css");
const rootBlock = declarations(blockOf(tokensCss, ":root"));
const lightBlock = declarations(blockOf(tokensCss, LIGHT_SELECTOR));

void test("each signal token holds exactly one bare hex, in the root block", () => {
  const bareHex = [
    ...tokensCss.matchAll(
      /(--(?:prio|col|status|src)-[a-z-]+):\s*(#[0-9a-fA-F]{3,8})\b/g,
    ),
  ].map((m) => m[1]);
  const names = new Set(bareHex);
  assert.equal(names.size, SIGNAL_COUNT);
  assert.equal(bareHex.length, SIGNAL_COUNT);
  const inRoot = rootBlock.filter(([name]) => SIGNAL_NAME.test(name));
  assert.deepEqual(new Set(inRoot.map(([name]) => name)), names);
});

void test("a light mix of a signal token repeats the root hex of that token", () => {
  const rootHex = new Map(rootBlock);
  const mixes = lightBlock.filter(([name]) => SIGNAL_NAME.test(name));
  assert.ok(mixes.length > 0);
  for (const [name, value] of mixes) {
    const mix = /^color-mix\(in srgb, (#[0-9a-fA-F]{6}) \d+%, black\)$/.exec(
      value,
    );
    assert.ok(mix, `${name} is not a mix of a hex with black: ${value}`);
    assert.equal(mix[1].toLowerCase(), rootHex.get(name)?.toLowerCase(), name);
  }
});

void test("the light block declares no signal token as a bare hex", () => {
  for (const [name, value] of lightBlock) {
    if (SIGNAL_NAME.test(name)) assert.doesNotMatch(value, /^#/, name);
  }
});

void test("both blocks declare their color scheme", () => {
  assert.match(blockOf(tokensCss, ":root"), /color-scheme:\s*dark\s*;/);
  assert.match(blockOf(tokensCss, LIGHT_SELECTOR), /color-scheme:\s*light\s*;/);
});

void test("every custom property read through var() is declared", () => {
  const declared = new Set<string>();
  const reads = new Map<string, string>();
  const prefixes = new Map<string, string>();
  assert.ok(sourceFiles.length > 0);
  for (const file of sourceFiles) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) declared.add(m[1]);
    for (const m of text.matchAll(/["'`](--[a-zA-Z0-9-]+)["'`]/g)) {
      declared.add(m[1]);
    }
    for (const m of text.matchAll(/var\(\s*(--[a-zA-Z0-9-]*)(\$\{)?/g)) {
      if (m[2] === undefined) reads.set(m[1], file);
      else prefixes.set(m[1], file);
    }
  }
  const missing = [...reads].filter(([name]) => !declared.has(name));
  assert.deepEqual(missing, []);
  const names = [...declared];
  const orphans = [...prefixes].filter(
    ([prefix]) => !names.some((name) => name.startsWith(prefix)),
  );
  assert.deepEqual(orphans, []);
});

void test("a literal colour of the root block has a light value or is theme neutral", () => {
  const light = new Set(lightBlock.map(([name]) => name));
  const root = new Set(rootBlock.map(([name]) => name));
  const neutral = rootBlock
    .filter(([, value]) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(value))
    .filter(([name, value]) => !value.includes("var(") && !light.has(name))
    .map(([name]) => name);
  assert.deepEqual(neutral, THEME_NEUTRAL);
  assert.deepEqual(
    [...light].filter((name) => !root.has(name)),
    [],
  );
});

void test("the contrast instrument passes on both themes", () => {
  const output = execFileSync(process.execPath, [INSTRUMENT], {
    cwd: join(WEB_ROOT, "../.."),
    encoding: "utf8",
  });
  for (const theme of ["dark", "light"]) {
    assert.match(
      output,
      new RegExp(`Summary \\(${theme}\\): \\d+ pair\\(s\\) checked, 0 failing`),
    );
  }
});
