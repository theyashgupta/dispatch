import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Server } from "node:http";
import type { Router } from "express";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const express = (await import("express")).default;
const { store } = await import("../store/board.store.js");
const { stopPollers } = await import("../adapters/poller.js");
const routers = {
  accounts: (await import("./accounts.route.js")).accountsRouter,
  archive: (await import("./archive.route.js")).archiveRouter,
  ask: (await import("./ask.route.js")).askRouter,
  board: (await import("./board.route.js")).boardRouter,
  calendar: (await import("./calendar.route.js")).calendarRouter,
  cards: (await import("./cards.route.js")).cardsRouter,
  connection: (await import("./connection.route.js")).connectionRouter,
  events: (await import("./events.route.js")).eventsRouter,
  github: (await import("./github.route.js")).githubRouter,
  hooks: (await import("./hooks.route.js")).hooksRouter,
  images: (await import("./images.route.js")).imagesRouter,
  items: (await import("./items.route.js")).itemsRouter,
  linear: (await import("./linear.route.js")).linearRouter,
  meetings: (await import("./meetings.route.js")).meetingsRouter,
  playbooks: (await import("./playbooks.route.js")).playbooksRouter,
  profile: (await import("./profile.route.js")).profileRouter,
  push: (await import("./push.route.js")).pushRouter,
  remote: (await import("./remote.route.js")).remoteRouter,
  sentry: (await import("./sentry.route.js")).sentryRouter,
  setup: (await import("./setup.route.js")).setupRouter,
  slack: (await import("./slack.route.js")).slackRouter,
  update: (await import("./update.route.js")).updateRouter,
  vault: (await import("./vault.route.js")).vaultRouter,
  viewer: (await import("./viewer.route.js")).viewerRouter,
  workspaces: (await import("./workspaces.route.js")).workspacesRouter,
};
const { terminalProxyRouter } = await import("./terminal-proxy.route.js");

await store.load();

after(() => {
  stopPollers();
  env.cleanup();
});

/** Mount one router alone, with no app-level error handler, and send one request to it. */
async function hitAlone(
  router: Router,
  mount: string,
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; type: string; text: string }> {
  const app = express();
  app.use(mount, express.json(), router);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}${mount}${route}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: res.status,
      type: res.headers.get("content-type") ?? "",
      text: await res.text(),
    };
  } finally {
    server.close();
  }
}

const CASES: [keyof typeof routers, string, string, unknown, number, string][] =
  [
    ["accounts", "PUT", "/accounts/active", {}, 400, "invalid-id"],
    [
      "archive",
      "POST",
      "/archive/GROUP-none/restore",
      undefined,
      404,
      "unknown archive id",
    ],
    [
      "ask",
      "POST",
      "/ask",
      { question: "q", history: [null] },
      400,
      "invalid ask",
    ],
    ["board", "GET", "/search", undefined, 400, "q is required"],
    ["calendar", "PUT", "/calendar/settings", [], 400, "invalid-body"],
    ["cards", "POST", "/cards/nope/comment", {}, 400, "Comment is empty."],
    [
      "connection",
      "GET",
      "/sources/nope/connection",
      undefined,
      404,
      "unknown source",
    ],
    ["events", "GET", "/events?limit=abc", undefined, 400, "invalid limit"],
    [
      "github",
      "GET",
      "/github/pr/o/r/0",
      undefined,
      400,
      "invalid pull request",
    ],
    ["hooks", "POST", "/hook/claude", {}, 401, "invalid hook token"],
    ["images", "GET", "/images", undefined, 400, "invalid-url"],
    ["items", "GET", "/items?state=bad", undefined, 400, "invalid state"],
    [
      "linear",
      "PUT",
      "/config/linear-state-map",
      undefined,
      400,
      "stateMap must be an object",
    ],
    [
      "meetings",
      "GET",
      "/meetings/transcript",
      undefined,
      400,
      "invalid-meeting-id",
    ],
    ["playbooks", "POST", "/playbooks", {}, 400, "invalid-name"],
    [
      "profile",
      "PUT",
      "/config/profile",
      undefined,
      400,
      "profile must be an object",
    ],
    ["push", "POST", "/push/subscribe", undefined, 400, "invalid-endpoint"],
    ["remote", "POST", "/remote/enable", undefined, 503, "server not ready"],
    ["sentry", "GET", "/sentry/issue/abc", undefined, 400, "invalid issue"],
    ["setup", "POST", "/setup/install", undefined, 400, "not-installable"],
    ["slack", "POST", "/slack/channels/resolve", {}, 400, "not-a-channel"],
    ["update", "POST", "/update/run", undefined, 400, "not-global-install"],
    ["vault", "POST", "/vault", {}, 400, "invalid-name"],
    ["viewer", "GET", "/viewer/file", undefined, 400, "invalid-path"],
    [
      "workspaces",
      "GET",
      "/workspaces?fresh=2",
      undefined,
      400,
      "fresh must be 1",
    ],
  ];

for (const [name, method, route, body, status, error] of CASES) {
  test(`${name} router alone answers ${method} ${route} with its own JSON ${status}`, async () => {
    const got = await hitAlone(routers[name], "/api", method, route, body);
    assert.equal(got.status, status);
    assert.match(got.type, /^application\/json/);
    assert.equal(got.text, JSON.stringify({ error }));
  });
}

test("every router that mounts httpErrorHandler has a case here", () => {
  assert.deepEqual(
    CASES.map(([name]) => name).sort(),
    Object.keys(routers).sort(),
  );
});

test("terminalProxyRouter alone answers an unknown session with an empty-body 404", async () => {
  const got = await hitAlone(
    terminalProxyRouter,
    "/sessions",
    "GET",
    "/no-such/terminal/scrollback",
  );
  assert.equal(got.status, 404);
  assert.equal(got.text, "");
});
