import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CentreToolbar } from "./CentreToolbar.js";

function markup(view: Parameters<typeof CentreToolbar>[0]["view"]): string {
  return renderToStaticMarkup(
    createElement(CentreToolbar, {
      inline: true,
      alertSlot: null,
      staleBadge: null,
      view,
      switcher: null,
      controls: null,
      onTerminal: null,
      onSettings: () => {},
      alert: null,
    }),
  );
}

test("the view toggle lists Bands and Tree with the current view pressed", () => {
  const html = markup({ value: "bands", onChange: () => {} });
  assert.match(html, /aria-label="Centre view"/);
  assert.match(html, />Bands</);
  assert.match(html, />Tree</);
  const bands = /<button[^>]*>Bands<\/button>/.exec(html)?.[0] ?? "";
  const tree = /<button[^>]*>Tree<\/button>/.exec(html)?.[0] ?? "";
  assert.match(bands, /data-state="on"/);
  assert.match(tree, /data-state="off"/);
});

test("no view toggle renders without a view prop", () => {
  assert.doesNotMatch(markup(null), /Centre view/);
});
