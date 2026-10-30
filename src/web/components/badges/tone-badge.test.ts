import assert from "node:assert/strict";
import { test } from "node:test";
import { Play } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionTone } from "../../../shared/session-states.js";
import { ToneBadge } from "./ToneBadge.js";

function render(tone: SessionTone): string {
  return renderToStaticMarkup(
    createElement(ToneBadge, { label: "Label", tone, glyph: Play }),
  );
}

const EXPECTED: ReadonlyArray<readonly [SessionTone, string]> = [
  ["neutral", "running"],
  ["muted", "idle"],
  ["attention", "waiting"],
  ["success", "stopped"],
  ["error", "errored"],
];

void test("every tone renders a state badge in its status colour", () => {
  for (const [tone, status] of EXPECTED) {
    const html = render(tone);
    assert.match(html, /data-tone="state"/, tone);
    assert.ok(
      html.includes(`--badge-state:var(--status-${status})`),
      `${tone} uses --status-${status}`,
    );
    assert.match(html, /Label/, tone);
    assert.match(html, /<svg/, tone);
  }
});
