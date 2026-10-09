import assert from "node:assert/strict";
import test, { after } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const { orchestratorRouter } = await import("./orchestrator.route.js");
after(() => env.cleanup());

interface Layer {
  route?: { path: unknown; methods: Record<string, boolean> };
}

const ROUTES = [
  "GET /cards",
  "GET /cards/:id",
  "GET /sessions",
  "GET /groups/:id/progress",
  "GET /sessions/:cardId/pane",
  "GET /events",
  "GET /policy",
  "GET /board-workspace",
  "POST /tickets",
  "PATCH /tickets/:id",
  "POST /tickets/:id/move",
  "POST /tickets/:id/comments",
  "POST /base-branches",
  "POST /groups",
  "POST /groups/:id/start",
  "POST /sessions/:cardId/input",
  "POST /groups/:cardId/approve-roadmap",
  "POST /sessions/:cardId/handoff",
  "POST /sessions/:cardId/resume",
  "POST /sessions/:cardId/stop",
  "POST /decisions",
  "POST /events/wait",
  "POST /groups/:cardId/ship",
  "GET /groups/:cardId/ship",
  "GET /state",
  "PUT /state",
];

const routes = (orchestratorRouter.stack as Layer[]).flatMap((layer) =>
  layer.route
    ? Object.keys(layer.route.methods).map(
        (method) => `${method.toUpperCase()} ${String(layer.route!.path)}`,
      )
    : [],
);

void test("the orchestrator router holds exactly the 26 tool routes", () => {
  assert.equal(ROUTES.length, 26);
  assert.deepEqual([...routes].sort(), [...ROUTES].sort());
});

void test("no orchestrator route path names push, merge, credit, vault or policy except GET /policy", () => {
  for (const route of routes) {
    if (route === "GET /policy") continue;
    assert.doesNotMatch(route, /push|merge|credit|vault|policy/i, route);
  }
});
