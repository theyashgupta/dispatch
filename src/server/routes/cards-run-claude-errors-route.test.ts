import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { Server } from "node:http";
import type { Card } from "../../shared/types.js";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
fs.writeFileSync(
  path.join(env.binDir, "tmux"),
  `#!/bin/sh
case "$*" in
  *has-session*) exit 0 ;;
  *show-environment*dsp-legacy*) exit 1 ;;
  *show-environment*) echo "DISPATCH_SHELL_SESSION=1"; exit 0 ;;
  *display-message*) echo 4242; exit 0 ;;
esac
exit 1
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

void test("POST /cards/:id/run-claude answers 409 for a legacy session and for an account that is gone", async (t) => {
  await store.load();
  const app = express();
  app.use("/api", express.json(), cardsRouter);
  app.use(httpErrorHandler);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  const cards = new Map<string, Card>();
  const real = store.getCard.bind(store);
  t.mock.method(store, "getCard", (id: string) => cards.get(id) ?? real(id));
  const craft = (id: string, tmuxSession: string, claudeAccountId: string) =>
    cards.set(id, {
      id,
      issueId: id,
      identifier: id,
      title: id,
      description: "",
      priority: 0,
      column: "in_progress",
      updatedAt: "2026-01-01T00:00:00.000Z",
      source: "local",
      tmuxSession,
      activeSessionId: "s1",
      sessions: [{ id: "s1", claudeAccountId }],
    } as Card);
  craft("LEGACY-1", "dsp-legacy", "default");
  craft("GONE-1", "dsp-shell", "ghost");
  const post = async (id: string) => {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/cards/${id}/run-claude`,
      { method: "POST" },
    );
    return { status: res.status, text: await res.text() };
  };
  try {
    assert.deepEqual(await post("LEGACY-1"), {
      status: 409,
      text: '{"error":"this session was started by an older Dispatch; it becomes a shell session after Claude exits and Resume runs"}',
    });
    assert.deepEqual(await post("GONE-1"), {
      status: 409,
      text: '{"error":"the session\'s Claude account is no longer available"}',
    });
  } finally {
    server.close();
  }
});

void test.after(() => env.cleanup());
