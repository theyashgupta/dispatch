import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CentreBranch } from "../domain/centre-graph.js";
import { BranchTile, type TileBehaviour } from "./BranchTile.js";

const BRANCH: CentreBranch = {
  id: "branch-1",
  cardId: "card-1",
  identifier: "LOCAL-1",
  title: "Title",
  state: "running",
  label: "Running",
  tone: "neutral",
  band: "running",
  actions: ["open"],
  detail: null,
  contextPercent: null,
  cost: null,
  playbook: null,
  planOrder: null,
  planSize: null,
  memberCount: null,
  stateSince: null,
  slot: 0,
};

const TILE: TileBehaviour = {
  disabled: false,
  reasonId: null,
  feedback: () => ({ result: null, failure: null }),
  register: () => () => {},
  onKeyDown: () => () => {},
  onOpen: () => {},
  draftOf: () => "",
  setDraft: () => {},
  onReply: () => Promise.resolve(),
  onAction: () => {},
  onOpenTerminal: () => {},
  onRetry: () => {},
};

function render(branch: CentreBranch): string {
  return renderToStaticMarkup(
    createElement(BranchTile, { branch, tile: TILE }),
  );
}

void test("a running tile pulses and a planned tile does not", () => {
  assert.match(render(BRANCH), /animate-status-pulse/);
  assert.doesNotMatch(
    render({ ...BRANCH, state: "planned" }),
    /animate-status-pulse/,
  );
});

void test("the identifier uses the mono type token, not text-xs", () => {
  const html = render(BRANCH);
  assert.match(html, /<span class="font-mono text-mono [^"]*">LOCAL-1<\/span>/);
  assert.doesNotMatch(
    html,
    /<span class="[^"]*\btext-xs\b[^"]*">LOCAL-1<\/span>/,
  );
});
