import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { THEME_PREFERENCES } from "../../lib/theme.js";
import { ThemeSection } from "./AppearanceTab.js";

/** Returns the text of static markup, so a nested tag cannot survive a single pass. */
function textOf(html: string): string {
  let text = "";
  let inTag = false;
  for (const char of html) {
    if (char === "<") inTag = true;
    else if (char === ">") inTag = false;
    else if (!inTag) text += char;
  }
  return text;
}

const LABELS = ["System", "Light", "Dark"];

void test("the theme group holds three buttons and presses only the chosen one", () => {
  for (const [chosen, preference] of THEME_PREFERENCES.entries()) {
    const html = renderToStaticMarkup(
      createElement(ThemeSection, {
        preference,
        onPreferenceChange: () => undefined,
      }),
    );
    assert.match(html, /role="group" aria-label="Theme"/);
    assert.match(html, /System follows your operating system\./);
    const buttons = [
      ...html.matchAll(
        /<button[^>]*aria-pressed="(true|false)"[^>]*>(.*?)<\/button>/g,
      ),
    ].map((m) => [textOf(m[2]), m[1]]);
    assert.deepEqual(
      buttons,
      LABELS.map((label, index) => [label, String(index === chosen)]),
    );
  }
});
