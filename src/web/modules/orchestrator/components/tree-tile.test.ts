import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  CentreTree as CentreTreeModel,
  TreeGroup,
  TreeOrchestrator,
} from "../domain/centre-tree.js";
import { treeFocusOrder } from "../domain/centre-tree.js";
import { CentreTree } from "./CentreTree.js";
import { TreeGroupTile, TreeOrchestratorNode } from "./TreeTile.js";

const GROUP: TreeGroup = {
  id: "g1",
  identifier: "LOCAL-1",
  title: "Group title",
  status: {
    state: "planned",
    sessionState: null,
    label: "Planned",
    tone: "muted",
  },
  unitCount: 0,
  dashed: false,
};

function orchestrator(
  id: string,
  role: "main" | "extra",
  groups: TreeGroup[] = [],
): TreeOrchestrator {
  return {
    id,
    focusId: `orch:${id}`,
    name: `Name ${id}`,
    role,
    status: {
      state: null,
      sessionState: null,
      label: "Stopped",
      tone: "muted",
    },
    groups,
  };
}

const FOCUS = { register: () => () => {}, onKeyDown: () => () => {} };

function renderGroup(group: TreeGroup, from = "main"): string {
  return renderToStaticMarkup(
    createElement(TreeGroupTile, { group, from, ...FOCUS, onOpen: () => {} }),
  );
}

function renderNode(node: TreeOrchestrator): string {
  return renderToStaticMarkup(
    createElement(TreeOrchestratorNode, {
      node,
      ...FOCUS,
      onSelect: () => {},
    }),
  );
}

test("a live session state renders its session badge label", () => {
  const html = renderGroup({
    ...GROUP,
    status: {
      state: "running",
      sessionState: "working",
      label: "Running",
      tone: "neutral",
    },
  });
  assert.ok(html.includes("Working"));
  assert.ok(!html.includes("Running"));
});

test("a null session state renders the status label", () => {
  const html = renderGroup({
    ...GROUP,
    status: {
      state: "done",
      sessionState: null,
      label: "Agent done",
      tone: "success",
    },
  });
  assert.ok(html.includes("Agent done"));
});

test("a group badge takes the Bands glyph of its state, not a tone glyph", () => {
  const html = renderGroup({
    ...GROUP,
    status: {
      state: "usage_limit",
      sessionState: null,
      label: "Usage limit",
      tone: "attention",
    },
  });
  assert.match(html, /lucide-gauge/);
  assert.doesNotMatch(html, /lucide-triangle-alert/);
});

test("the unit count renders plural, singular, or nothing", () => {
  assert.ok(renderGroup({ ...GROUP, unitCount: 3 }).includes("3 units"));
  const one = renderGroup({ ...GROUP, unitCount: 1 });
  assert.ok(one.includes("1 unit"));
  assert.ok(!one.includes("1 units"));
  assert.ok(!renderGroup({ ...GROUP, unitCount: 0 }).includes("unit"));
});

test("the group tile is a button that names its orchestrator", () => {
  const html = renderGroup(GROUP, "search");
  assert.match(html, /^<li [^>]*data-edge-from="search"/);
  assert.match(html, /<button[^>]*type="button"/);
});

test("the orchestrator node is a button labelled by role", () => {
  const extra = renderNode(orchestrator("search", "extra"));
  assert.match(extra, /^<button[^>]*type="button"[^>]*data-edge-node="search"/);
  assert.ok(extra.includes("Extra orchestrator"));
  assert.ok(extra.includes("open in Bands"));
  const main = renderNode(orchestrator("main", "main"));
  assert.ok(main.includes("Orchestrator"));
  assert.ok(!main.includes("Extra orchestrator"));
});

test("the tree renders one section per orchestrator in order", () => {
  const tree: CentreTreeModel = {
    orchestrators: [
      orchestrator("main", "main", [GROUP]),
      orchestrator("search", "extra"),
    ],
    edges: [{ from: "main", to: "g1", dashed: false }],
  };
  const html = renderToStaticMarkup(
    createElement(CentreTree, {
      tree,
      paths: [],
      containerRef: () => {},
      ...FOCUS,
      onOpenGroup: () => {},
      onSelectOrchestrator: () => {},
    }),
  );
  assert.equal(html.split("<section").length - 1, 2);
  assert.ok(html.indexOf("Name main") < html.indexOf("Name search"));
  assert.equal(html.split("No groups").length - 1, 1);
  assert.ok(html.indexOf("No groups") > html.indexOf("Name search"));
});

test("the tree registers its tiles in the tree focus order", () => {
  const second: TreeGroup = { ...GROUP, id: "G-2" };
  const first: TreeGroup = { ...GROUP, id: "G-1" };
  const tree: CentreTreeModel = {
    orchestrators: [
      orchestrator("main", "main", [first]),
      orchestrator("search", "extra", [second]),
    ],
    edges: [],
  };
  const registered: string[] = [];
  renderToStaticMarkup(
    createElement(CentreTree, {
      tree,
      paths: [],
      containerRef: () => {},
      register: (id: string) => {
        registered.push(id);
        return () => {};
      },
      onKeyDown: () => () => {},
      onOpenGroup: () => {},
      onSelectOrchestrator: () => {},
    }),
  );
  assert.deepEqual(registered, ["orch:main", "G-1", "orch:search", "G-2"]);
  assert.deepEqual(registered, treeFocusOrder(tree));
});
