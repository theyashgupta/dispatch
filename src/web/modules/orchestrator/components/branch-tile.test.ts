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
  expanded: () => false,
  onToggle: () => {},
};

function render(branch: CentreBranch, tile: TileBehaviour = TILE): string {
  return renderToStaticMarkup(createElement(BranchTile, { branch, tile }));
}

const GROUP_BRANCH: CentreBranch = {
  ...BRANCH,
  group: {
    units: [
      {
        unit: 1,
        name: "Schema",
        state: "done",
        stateLine: "Shipped",
        accessibleName: "Unit 1, Schema, shipped",
        phase: null,
      },
      {
        unit: 2,
        name: "Backfill",
        state: "current",
        stateLine: "Phase 3 of 9",
        accessibleName: "Unit 2, Backfill, in progress",
        phase: { passed: 2, total: 9 },
      },
    ],
    members: [
      {
        id: "m1",
        identifier: "ORC-121",
        title: "Billing schema tickets",
        state: "in_progress",
        label: "In progress",
        tone: "neutral",
      },
      {
        id: "m2",
        identifier: "ORC-123",
        title: "Billing cutover runbook",
        state: "attention",
        label: "Needs attention",
        tone: "error",
      },
    ],
  },
};

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

void test("a group tile has a closed disclosure with the unit and ticket counts", () => {
  const html = render(GROUP_BRANCH);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Show 2 units and 2 tickets/);
  assert.match(html, /\binert=""/);
});

void test("an open group tile lists the units and the tickets", () => {
  const html = render(GROUP_BRANCH, { ...TILE, expanded: () => true });
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /Hide units and tickets/);
  assert.doesNotMatch(html, /\binert=""/);
  for (const text of [
    "Schema",
    "Shipped",
    "Backfill",
    "Phase 3 of 9",
    "ORC-121",
    "Billing schema tickets",
    "In progress",
    "ORC-123",
    "Billing cutover runbook",
    "Needs attention",
  ]) {
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /aria-label="Tickets"/);
});

void test("a group without units says so and counts only its tickets", () => {
  const html = render({
    ...GROUP_BRANCH,
    group: {
      units: null,
      members: GROUP_BRANCH.group?.members.slice(0, 1) ?? [],
    },
  });
  assert.match(html, /No units yet/);
  assert.match(html, /Show 1 ticket</);
});

void test("a group with no units and no tickets still offers the disclosure", () => {
  const html = render({ ...GROUP_BRANCH, group: { units: null, members: [] } });
  assert.match(html, /Show units and tickets</);
  assert.match(html, /No units yet/);
});

void test("the closed text drops a zero count and uses the singular for one", () => {
  const units = GROUP_BRANCH.group?.units ?? [];
  const members = GROUP_BRANCH.group?.members ?? [];
  const text = (u: typeof units, m: typeof members) =>
    render({ ...GROUP_BRANCH, group: { units: u, members: m } });
  assert.match(text(units, []), /Show 2 units</);
  assert.match(
    text(units.slice(0, 1), members.slice(0, 1)),
    /Show 1 unit and 1 ticket</,
  );
  const empty = text([], members);
  assert.match(empty, /No units yet/);
  assert.match(empty, /Show 2 tickets</);
  assert.doesNotMatch(text(units, []), /aria-label="Tickets"/);
});

void test("a tile with no group renders no disclosure", () => {
  assert.doesNotMatch(render(BRANCH), /aria-expanded/);
});
