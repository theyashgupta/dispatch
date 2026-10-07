import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { after, afterEach, test } from "node:test";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

const env = isolateEnv();
fs.writeFileSync(
  path.join(env.binDir, "tmux"),
  '#!/bin/sh\ncase "$*" in\n  *capture-pane*)\n    [ "$TMUX_STUB" = fail ] && { echo boom >&2; exit 1; }\n    printf "history-line\\n"\n    ;;\nesac\n',
  { mode: 0o755 },
);
fs.writeFileSync(
  path.join(env.binDir, "ttyd"),
  '#!/bin/sh\necho "Listening on port: $TTYD_STUB_PORT" >&2\nexec sleep 30\n',
  { mode: 0o755 },
);
const { store } = await import("../store/board.store.js");
const { ensureTtyd, killTtyd } = await import("../adapters/ttyd.js");
const express = (await import("express")).default;
const { terminalProxyRouter } = await import("./terminal-proxy.route.js");

await store.load();

const app = express();
app.use("/sessions", terminalProxyRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/sessions`;

const workspace = path.join(env.root, "ws");
fs.mkdirSync(path.join(workspace, "sub"), { recursive: true });
fs.writeFileSync(path.join(workspace, "sub", "notes.md"), "# notes\n");
fs.writeFileSync(path.join(workspace, "plain.txt"), "x");

let seq = 0;
async function makeSession(): Promise<{ sessionId: string; tmux: string }> {
  const card = await store.createLocalCard(
    DEFAULT_BOARD_KEY,
    `proxy ${++seq}`,
    "",
  );
  const tmux = `dsp-proxy-${process.pid}-${seq}`;
  await store.completeStart(card.id, undefined, {
    workspacePath: workspace,
    tmuxSession: tmux,
    branch: `proxy-${seq}`,
  });
  return { sessionId: store.getCard(card.id)!.activeSessionId!, tmux };
}

const tracked: string[] = [];
const upstreams: Server[] = [];
after(() => {
  for (const t of tracked) killTtyd(t);
  for (const u of upstreams) u.close();
  server.close();
  env.cleanup();
});
afterEach(() => {
  delete process.env.TMUX_STUB;
});

async function expectBodyless(res: Response, status: number): Promise<void> {
  assert.equal(res.status, status);
  assert.equal(res.headers.get("content-type"), null);
  assert.equal(await res.text(), "");
}

async function attachTtyd(
  tmux: string,
  sessionId: string,
  port: number,
): Promise<void> {
  process.env.TTYD_STUB_PORT = String(port);
  tracked.push(tmux);
  await ensureTtyd(tmux, sessionId);
}

test("GET scrollback for an unknown session answers 404 with an empty body", async () => {
  await expectBodyless(await fetch(`${base}/no-such/terminal/scrollback`), 404);
});

test("GET scrollback answers 502 with an empty body when the capture fails", async () => {
  const { sessionId } = await makeSession();
  process.env.TMUX_STUB = "fail";
  await expectBodyless(
    await fetch(`${base}/${sessionId}/terminal/scrollback`),
    502,
  );
});

test("GET scrollback answers 200 text/plain with the history", async () => {
  const { sessionId } = await makeSession();
  const res = await fetch(`${base}/${sessionId}/terminal/scrollback`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(res.headers.get("cache-control"), "no-cache");
  assert.equal(await res.text(), "history-line\n");
});

test("GET markdown answers 400 with an empty body when path is missing or repeated", async () => {
  const { sessionId } = await makeSession();
  await expectBodyless(
    await fetch(`${base}/${sessionId}/terminal/markdown`),
    400,
  );
  await expectBodyless(
    await fetch(`${base}/${sessionId}/terminal/markdown?path=a.md&path=b.md`),
    400,
  );
  await expectBodyless(await fetch(`${base}/no-such/terminal/markdown`), 400);
});

test("GET markdown answers 404 with an empty body for an unknown session", async () => {
  await expectBodyless(
    await fetch(`${base}/no-such/terminal/markdown?path=notes.md`),
    404,
  );
});

test("GET markdown answers 404 with an empty body for a non-markdown name", async () => {
  const { sessionId } = await makeSession();
  await expectBodyless(
    await fetch(`${base}/${sessionId}/terminal/markdown?path=plain.txt`),
    404,
  );
});

test("GET markdown answers 404 with an empty body when no candidate holds the file", async () => {
  const { sessionId } = await makeSession();
  await expectBodyless(
    await fetch(`${base}/${sessionId}/terminal/markdown?path=missing.md`),
    404,
  );
  await expectBodyless(
    await fetch(
      `${base}/${sessionId}/terminal/markdown?path=${encodeURIComponent("../outside.md")}`,
    ),
    404,
  );
});

test("GET markdown answers 404 with an empty body when the lookup throws", async (t) => {
  const { sessionId } = await makeSession();
  t.mock.method(store, "sessionsWithTmux", () => {
    throw new Error("store down");
  });
  await expectBodyless(
    await fetch(`${base}/${sessionId}/terminal/markdown?path=notes.md`),
    404,
  );
});

test("GET markdown answers 200 json with the resolved path", async () => {
  const { sessionId } = await makeSession();
  const res = await fetch(
    `${base}/${sessionId}/terminal/markdown?path=notes.md`,
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(
    await res.text(),
    JSON.stringify({ path: path.join(workspace, "sub", "notes.md") }),
  );
});

test("the terminal wildcard answers 404 with an empty body for an unknown session", async () => {
  await expectBodyless(await fetch(`${base}/no-such/terminal/`), 404);
  await expectBodyless(await fetch(`${base}/no-such/terminal/index.js`), 404);
  await expectBodyless(
    await fetch(`${base}/no-such/terminal/token`, { method: "POST" }),
    404,
  );
});

test("the terminal wildcard answers 502 with an empty body when the live ttyd refuses the forward", async () => {
  const upstream: Server = await new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { sessionId, tmux } = await makeSession();
  await attachTtyd(
    tmux,
    sessionId,
    (upstream.address() as net.AddressInfo).port,
  );
  await new Promise((resolve) => upstream.close(resolve));
  await expectBodyless(
    await fetch(`${base}/${sessionId}/terminal/token`, { method: "POST" }),
    502,
  );
});

test("a proxied upstream error status passes through untouched", async () => {
  const upstream: Server = await new Promise((resolve) => {
    const s = http.createServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("upstream body");
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  upstreams.push(upstream);
  const { sessionId, tmux } = await makeSession();
  await attachTtyd(
    tmux,
    sessionId,
    (upstream.address() as net.AddressInfo).port,
  );
  const res = await fetch(`${base}/${sessionId}/terminal/token`, {
    method: "POST",
    body: "x",
  });
  assert.equal(res.status, 500);
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(await res.text(), "upstream body");
});
