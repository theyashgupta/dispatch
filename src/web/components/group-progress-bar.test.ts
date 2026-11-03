import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TrackNode } from "../../shared/track-nodes.js";
import { GroupProgressBar } from "./GroupProgressBar.js";

const NODES: TrackNode[] = [
  {
    unit: 1,
    name: "Schema",
    state: "done",
    stateLine: "Done 14:10",
    accessibleName: "Unit 1, Schema, done",
    phase: null,
  },
  {
    unit: 2,
    name: "Backfill",
    state: "current",
    stateLine: "Phase 4 of 9",
    accessibleName: "Unit 2, Backfill, in progress",
    phase: { passed: 3, total: 9 },
  },
];

void test("the responsive track switches to a row at lg and the vertical track never does", () => {
  const responsive = renderToStaticMarkup(
    createElement(GroupProgressBar, { nodes: NODES }),
  );
  const vertical = renderToStaticMarkup(
    createElement(GroupProgressBar, { nodes: NODES, orientation: "vertical" }),
  );
  assert.match(
    responsive,
    /<ol class="m-0 flex list-none flex-col p-0 lg:flex-row">/,
  );
  assert.match(responsive, /lg:bg-linear-to-r/);
  assert.doesNotMatch(vertical, /lg:/);
  assert.equal(vertical.match(/You are here/g)?.length, 1);
  assert.match(vertical, /Done 14:10/);
  assert.match(vertical, /Phase 4 of 9/);
});
