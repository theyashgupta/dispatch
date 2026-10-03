import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import {
  LIGHT_SCHEME_QUERY,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  parseThemePreference,
  resolveTheme,
  type ThemePreference,
} from "./theme.js";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const SHELLS = ["index.html", "viewer.html", "gallery.html"];
const STORED_VALUES = ["system", "light", "dark", null, "garbage", "LIGHT", ""];

/** Returns the text of the pre-paint script of an html shell, one trimmed line per line. */
function prepaintScript(shell: string): string {
  const html = readFileSync(join(WEB_ROOT, shell), "utf8");
  const match = /<script>([\s\S]*?)<\/script>/i.exec(html);
  assert.ok(match, `${shell} holds no inline classic script`);
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n");
}

interface Painted {
  theme: string | undefined;
  scheme: string | undefined;
}

/** Runs the pre-paint script against fakes of the three browser objects it touches. */
function paint(
  script: string,
  stored: string | null,
  systemIsLight: boolean,
  storageThrows = false,
): Painted {
  const painted: Painted = { theme: undefined, scheme: undefined };
  runInNewContext(script, {
    localStorage: {
      getItem: (key: string) => {
        if (storageThrows) throw new Error("storage is blocked");
        return key === THEME_STORAGE_KEY ? stored : null;
      },
    },
    matchMedia: (query: string) => ({
      matches: query === LIGHT_SCHEME_QUERY && systemIsLight,
    }),
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => {
          if (name === "data-theme") painted.theme = value;
        },
      },
      querySelector: (selector: string) =>
        selector === 'meta[name="color-scheme"]'
          ? {
              setAttribute: (name: string, value: string) => {
                if (name === "content") painted.scheme = value;
              },
            }
          : null,
    },
  });
  return painted;
}

void test("the preference parser accepts the closed set and nothing else", () => {
  for (const value of THEME_PREFERENCES) {
    assert.equal(parseThemePreference(value), value);
  }
  for (const value of [null, undefined, "", "garbage", "LIGHT", 1, {}]) {
    assert.equal(parseThemePreference(value), "system");
  }
});

void test("the resolver follows the system only for the system preference", () => {
  const table: [ThemePreference, boolean, string][] = [
    ["system", true, "light"],
    ["system", false, "dark"],
    ["light", true, "light"],
    ["light", false, "light"],
    ["dark", true, "dark"],
    ["dark", false, "dark"],
  ];
  for (const [preference, systemIsLight, expected] of table) {
    assert.equal(resolveTheme(preference, systemIsLight), expected);
  }
});

void test("both html shells hold the same pre-paint script", () => {
  assert.equal(prepaintScript(SHELLS[0]), prepaintScript(SHELLS[1]));
});

void test("the pre-paint script is a classic script with no comment and no colour", () => {
  for (const shell of SHELLS) {
    const script = prepaintScript(shell);
    assert.doesNotMatch(script, /\/\/|\/\*/);
    assert.doesNotMatch(script, /#[0-9a-fA-F]{3,8}\b|rgb\(/);
    assert.match(script, /dsp\.theme/);
  }
});

void test("the pre-paint script paints what the resolver resolves", () => {
  for (const shell of SHELLS) {
    const script = prepaintScript(shell);
    for (const stored of STORED_VALUES) {
      for (const systemIsLight of [true, false]) {
        const expected = resolveTheme(
          parseThemePreference(stored),
          systemIsLight,
        );
        assert.deepEqual(
          paint(script, stored, systemIsLight),
          { theme: expected, scheme: expected },
          `${shell}, stored ${String(stored)}, system light ${systemIsLight}`,
        );
      }
    }
  }
});

void test("a storage that throws leaves the page on the system theme", () => {
  for (const shell of SHELLS) {
    const script = prepaintScript(shell);
    assert.equal(paint(script, "light", true, true).theme, "light");
    assert.equal(paint(script, "light", false, true).theme, "dark");
  }
});

void test("the color scheme meta sits above the pre-paint script", () => {
  for (const shell of SHELLS) {
    const html = readFileSync(join(WEB_ROOT, shell), "utf8");
    const meta = html.indexOf('<meta name="color-scheme"');
    assert.ok(meta >= 0 && meta < html.indexOf("<script>"), shell);
  }
});

void test("the pre-paint script tag carries no attribute", () => {
  for (const shell of SHELLS) {
    const html = readFileSync(join(WEB_ROOT, shell), "utf8");
    const tags = [...html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]);
    assert.equal(tags.filter((attributes) => attributes === "").length, 1);
    assert.equal(tags[0], "");
  }
});
