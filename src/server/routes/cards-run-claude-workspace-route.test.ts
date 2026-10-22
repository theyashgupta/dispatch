import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

const env = isolateEnv();
const tmuxLog = path.join(env.root, "tmux.log");
fs.writeFileSync(
  path.join(env.binDir, "tmux"),
  `#!/bin/sh
echo "$*" >> "${tmuxLog}"
case "$*" in
  *has-session*) exit 0 ;;
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

void test("POST /cards/:id/run-claude refuses a missing workspace folder with workspace-missing and moves the card to Needs input", async () => {
  await store.load();
  const app = express();
  app.use("/api", express.json(), cardsRouter);
  app.use(httpErrorHandler);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  const workspacePath = path.join(env.root, "gone-workspace");
  assert.equal(fs.existsSync(workspacePath), false);
  const created = await store.createLocalCard(
    DEFAULT_BOARD_KEY,
    "gone workspace",
    "",
  );
  await store.completeStart(created.id, undefined, {
    workspacePath,
    tmuxSession: "dsp-gone-workspace",
    branch: "gone-workspace",
  });
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/cards/${created.id}/run-claude`,
      { method: "POST" },
    );
    assert.equal(res.status, 409);
    assert.equal(await res.text(), '{"error":"workspace-missing"}');
  } finally {
    server.close();
  }
  const card = store.getCard(created.id);
  assert.equal(card?.column, "needs_input");
  assert.equal(
    card?.statusReason,
    `resume: Resume failed: workspace-missing: ${workspacePath}`,
  );
  const active = card?.sessions?.find((s) => s.id === card.activeSessionId);
  assert.equal(active?.state, "needs_input");
  assert.equal(active?.stateReason, "resume_failed");
  assert.doesNotMatch(fs.readFileSync(tmuxLog, "utf8"), /send-keys/);
});

void test.after(() => env.cleanup());
