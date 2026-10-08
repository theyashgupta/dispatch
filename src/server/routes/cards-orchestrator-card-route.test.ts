import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { Server } from "node:http";
import type { Card } from "../../shared/types.js";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const tmuxLog = path.join(env.root, "tmux-calls.log");
fs.writeFileSync(
  path.join(env.binDir, "tmux"),
  `#!/bin/sh
echo "$*" >> "${tmuxLog}"
case "$*" in
  *has-session*) exit 0 ;;
  *show-environment*) echo "DISPATCH_SHELL_SESSION=1"; exit 0 ;;
  *display-message*) echo 4242; exit 0 ;;
esac
exit 0
`,
  { mode: 0o755 },
);
fs.writeFileSync(path.join(env.binDir, "ps"), "#!/bin/sh\necho '4242 4242'\n", {
  mode: 0o755,
});
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { cardsRouter } = await import("./cards.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

void test("POST /cards/:id/run-claude and /start refuse a hidden orchestrator card with 409 before any side effect", async (t) => {
  await store.load();
  const app = express();
  app.use("/api", express.json(), cardsRouter);
  app.use(httpErrorHandler);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  const hidden = {
    id: "hidden-card",
    issueId: "hidden-card",
    identifier: "hidden-card",
    title: "Board orchestrator",
    description: "",
    priority: 0,
    column: "in_progress",
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "orchestrator",
    tmuxSession: "dsp-orch",
    activeSessionId: "s1",
    sessions: [{ id: "s1", claudeAccountId: "default" }],
    workspace: { folder: "/tmp/w", repos: [{ path: "/tmp/r", base: "main" }] },
  } as unknown as Card;
  const real = store.getCard.bind(store);
  t.mock.method(store, "getCard", (id: string) =>
    id === hidden.id ? hidden : real(id),
  );
  const setWorkspace = t.mock.method(store, "setCardWorkspace", () =>
    Promise.resolve(),
  );
  const post = async (route: string, body?: unknown) => {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/cards/${hidden.id}/${route}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      },
    );
    return { status: res.status, body: (await res.json()) as unknown };
  };
  const refusal = {
    status: 409,
    body: { error: "orchestrator-card", reason: "use the orchestrator panel" },
  };
  try {
    assert.deepEqual(await post("run-claude"), refusal);
    assert.deepEqual(
      await post("start", {
        folder: "/tmp/w",
        repos: [{ path: "/tmp/r", base: "main" }],
      }),
      refusal,
    );
    assert.deepEqual(await post("start"), refusal);
    assert.equal(fs.existsSync(tmuxLog), false, "no tmux call ran");
    assert.equal(setWorkspace.mock.callCount(), 0);
  } finally {
    server.close();
  }
});
