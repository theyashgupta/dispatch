import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import type { Server } from "node:http";
import type { BoardKey } from "../../shared/types.js";
import { parseBoardKey } from "../../shared/board-key.js";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const express = (await import("express")).default;
const { viewerRouter } = await import("./viewer.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const ACME = parseBoardKey("ACME") as BoardKey;
const localRoot = path.join(env.root, "local-sessions");
const acmeRoot = path.join(env.root, "acme-sessions");
const outside = path.join(env.root, "outside");
for (const dir of [localRoot, acmeRoot, outside]) {
  fs.mkdirSync(dir, { recursive: true });
}
fs.writeFileSync(path.join(localRoot, "local.md"), "# local\n");
fs.writeFileSync(path.join(acmeRoot, "acme.md"), "# acme\n");
fs.writeFileSync(path.join(outside, "away.md"), "# away\n");

setOrchestrationConfig({ linearApiKey: "", workspaceRoot: localRoot });
await store.load();
await store.createBoard({
  key: ACME,
  name: "Acme",
  workspaceRoot: acmeRoot,
  repositories: [],
  linearTeamKeys: [],
});

const app = express();
app.use("/api", express.json(), viewerRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

after(() => {
  server.close();
  env.cleanup();
});

const get = (p: string) =>
  fetch(`${base}/viewer/file?path=${encodeURIComponent(p)}`);

test("GET /viewer/file serves a file under the ACME sessions folder", async () => {
  const res = await get(path.join(acmeRoot, "acme.md"));

  assert.equal(res.status, 200);
  assert.equal(await res.text(), "# acme\n");
});

test("GET /viewer/file still serves a file under Config.workspaceRoot", async () => {
  const res = await get(path.join(localRoot, "local.md"));

  assert.equal(res.status, 200);
  assert.equal(await res.text(), "# local\n");
});

test("GET /viewer/file refuses a path outside each board folder and live session path", async () => {
  const res = await get(path.join(outside, "away.md"));

  assert.equal(res.status, 404);
  assert.equal(await res.text(), '{"error":"not-found"}');
});

test("GET /viewer/file refuses a symlink that leaves the ACME folder, a dot-dot escape and a sibling folder sharing the prefix", async () => {
  fs.symlinkSync(
    path.join(outside, "away.md"),
    path.join(acmeRoot, "link-file.md"),
  );
  fs.symlinkSync(outside, path.join(acmeRoot, "link-dir"));
  const evil = `${acmeRoot}-evil`;
  fs.mkdirSync(evil, { recursive: true });
  fs.writeFileSync(path.join(evil, "x.md"), "# evil\n");

  for (const attempt of [
    path.join(acmeRoot, "link-file.md"),
    path.join(acmeRoot, "link-dir", "away.md"),
    path.join(acmeRoot, "..", "outside", "away.md"),
    path.join(evil, "x.md"),
  ]) {
    const res = await get(attempt);
    assert.equal(res.status, 404, attempt);
    assert.equal(await res.text(), '{"error":"not-found"}', attempt);
  }
});

test("GET /viewer/file serves the workspace path of a live session of any board and only while the session lives", async () => {
  const workspace = path.join(env.root, "elsewhere", "ACME-9");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "notes.md"), "# live\n");
  const before = await get(path.join(workspace, "notes.md"));
  assert.equal(before.status, 404);

  const card = await store.createLocalCard(ACME, "live viewer", "");
  await store.completeStart(card.id, undefined, {
    workspacePath: workspace,
    tmuxSession: "dsp-live-viewer-none",
    branch: "live-viewer",
  });
  const live = await get(path.join(workspace, "notes.md"));
  assert.equal(live.status, 200);
  assert.equal(await live.text(), "# live\n");
  const sibling = await get(path.join(env.root, "elsewhere", "other.md"));
  assert.equal(sibling.status, 404);

  await store.markSessionLost(card.id, undefined);
  const lost = await get(path.join(workspace, "notes.md"));
  assert.equal(lost.status, 404);
});

test("GET /viewer/file still serves the folder of an archived board", async () => {
  const OLD = parseBoardKey("OLDB") as BoardKey;
  const oldRoot = path.join(env.root, "old-sessions");
  fs.mkdirSync(oldRoot, { recursive: true });
  fs.writeFileSync(path.join(oldRoot, "old.md"), "# old\n");
  await store.createBoard({
    key: OLD,
    name: "Old",
    workspaceRoot: oldRoot,
    repositories: [],
    linearTeamKeys: [],
  });
  await store.setBoardArchived(OLD, true);
  const res = await get(path.join(oldRoot, "old.md"));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "# old\n");
});
