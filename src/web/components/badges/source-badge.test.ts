import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceBadge } from "./SourceBadge.js";
import { SourceIcon } from "./SourceIcon.js";

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

function render(source: string, label = false): string {
  return renderToStaticMarkup(createElement(SourceBadge, { source, label }));
}

void test("a badge is an image with the source name and no visible text", () => {
  const html = render("github");
  assert.match(
    html,
    /^<span data-slot="badge"[^>]* role="img" aria-label="GitHub" title="GitHub"/,
  );
  assert.equal(textOf(html), "");
  assert.match(html, /<svg viewBox="0 0 24 24" width="12" height="12"/);
  assert.match(html, /style="--badge-state:var\(--src-github\)"/);
  assert.match(
    html,
    /bg-\[color-mix\(in_srgb,var\(--badge-state\)_16%,transparent\)\]/,
  );
});

void test("the 32 px tile is decorative, holds a 16 px mark and falls back like the badge", () => {
  const tile = renderToStaticMarkup(
    createElement(SourceIcon, { source: "github" }),
  );
  assert.match(tile, /^<span data-slot="badge"[^>]* aria-hidden="true"/);
  assert.match(tile, /class="[^"]*size-8 /);
  assert.match(tile, /<svg viewBox="0 0 24 24" width="16" height="16"/);
  assert.match(tile, /16%,transparent/);
  const unknown = renderToStaticMarkup(
    createElement(SourceIcon, { source: "zzz" }),
  );
  assert.match(unknown, /lucide-tag/);
  assert.match(unknown, /border-border/);
  assert.doesNotMatch(unknown, /16%,transparent/);
});

void test("a meeting badge is named Meeting", () => {
  assert.match(render("meeting"), /aria-label="Meeting"/);
});

void test("a labelled badge shows the name once and hides the tile", () => {
  const html = render("linear", true);
  assert.equal(textOf(html), "Linear");
  assert.match(html, /<span data-slot="badge"[^>]* aria-hidden="true"/);
  assert.doesNotMatch(html, /role="img"|aria-label=|title=/);
});

void test("an unknown source gets the tag glyph, the neutral edge and a safe name", () => {
  for (const [id, name] of [
    ["zzz", "Zzz"],
    ["constructor", "Constructor"],
    ["", "Source"],
  ]) {
    const html = render(id);
    assert.match(html, new RegExp(`aria-label="${name}"`), id);
    assert.match(html, /lucide-tag/, id);
    assert.match(html, /border-border/, id);
    assert.doesNotMatch(html, /16%,transparent/, id);
  }
});

void test("a local and a group badge keep their glyph, their name and the neutral edge", () => {
  for (const [id, name, glyph] of [
    ["local", "Local", "lucide-file-text"],
    ["group", "Group", "lucide-layers"],
  ]) {
    const html = render(id);
    assert.match(html, new RegExp(`aria-label="${name}"`), id);
    assert.match(html, new RegExp(glyph), id);
    assert.match(html, /border-border/, id);
    assert.doesNotMatch(html, /16%,transparent/, id);
  }
});
