import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";

const env = isolateEnv();
const pidFile = path.join(env.root, "stub.pid");
process.env.PLAYBOOK_STUB_PID = pidFile;
fs.writeFileSync(
  path.join(env.binDir, "claude"),
  `#!/bin/sh
echo $$ > "$PLAYBOOK_STUB_PID"
case "$PLAYBOOK_STUB_MODE" in
  answer) echo "Stub draft"; exit 0 ;;
  sleep) exec sleep 30 ;;
  fail) echo "stub failure" >&2; exit 1 ;;
  empty) exit 0 ;;
esac
exit 0
`,
  { mode: 0o755 },
);
const playbooksDir = path.join(env.dispatchDir, "playbooks");

const express = (await import("express")).default;
const { playbooksRouter } = await import("./playbooks.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const app = express();
app.use("/api", express.json({ limit: "5mb" }), playbooksRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  if (fs.existsSync(playbooksDir)) fs.chmodSync(playbooksDir, 0o700);
  server.close();
  env.cleanup();
});

beforeEach(() => {
  fs.rmSync(pidFile, { force: true });
  delete process.env.PLAYBOOK_STUB_MODE;
});

async function call(
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

/**
 * Assert the exact status and the exact response bytes, so a refactor that keeps the status but
 * changes the body shape fails here.
 */
async function expectError(
  method: string,
  route: string,
  body: unknown,
  status: number,
  code: string,
): Promise<void> {
  const res = await call(method, route, body);
  assert.equal(res.status, status);
  assert.equal(res.text, JSON.stringify({ error: code }));
}

const validBody = "Do the work.\n";

test("GET /playbooks lists nothing on a fresh data folder", async () => {
  const res = await call("GET", "/playbooks");
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.text), { playbooks: [] });
});

test("GET /playbooks/picker answers valid, invalid and lastUsed", async () => {
  const res = await call("GET", "/playbooks/picker");
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.text), {
    valid: [],
    invalid: [],
    lastUsed: null,
  });
});

test("POST /playbooks creates a playbook and answers it", async () => {
  const res = await call("POST", "/playbooks", {
    name: "  Alpha  ",
    body: validBody,
  });
  assert.equal(res.status, 200);
  const json = JSON.parse(res.text) as {
    playbook: { name: string; slug: string };
  };
  assert.equal(json.playbook.name, "Alpha");
  assert.equal(json.playbook.slug, "alpha");
});

test("POST /playbooks rejects a duplicate name with 409", async () => {
  await call("POST", "/playbooks", { name: "Dup", body: validBody });
  await expectError(
    "POST",
    "/playbooks",
    { name: "Alpha", body: validBody },
    409,
    "name-exists",
  );
});

test("POST /playbooks rejects a body that carries the status marker", async () => {
  await expectError(
    "POST",
    "/playbooks",
    { name: "Footgun", body: "DISPATCH_STATUS: DONE - x" },
    400,
    "footgun",
  );
});

test("POST /playbooks validates the name first, then the body", async () => {
  const cases: [unknown, string][] = [
    [undefined, "invalid-name"],
    [[], "invalid-name"],
    [{}, "invalid-name"],
    [{ name: 123, body: validBody }, "invalid-name"],
    [{ name: "", body: validBody }, "invalid-name"],
    [{ name: "   ", body: validBody }, "invalid-name"],
    [{ name: "x".repeat(81), body: validBody }, "invalid-name"],
    [{ name: "a\nb", body: validBody }, "invalid-name"],
    [{ name: "a\rb", body: validBody }, "invalid-name"],
    [{ name: 5, body: 5 }, "invalid-name"],
    [{ name: "Beta" }, "invalid-body"],
    [{ name: "Beta", body: 7 }, "invalid-body"],
    [{ name: "Beta", body: "x".repeat(262145) }, "invalid-body"],
    [{ name: "Beta", body: "é".repeat(131073) }, "invalid-body"],
    [{ name: "😀".repeat(41), body: validBody }, "invalid-name"],
    [{ name: "😀".repeat(41), body: 5 }, "invalid-name"],
  ];
  for (const [body, code] of cases) {
    await expectError("POST", "/playbooks", body, 400, code);
  }
});

test("POST /playbooks accepts the limits exactly", async () => {
  const name = "n".repeat(80);
  const res = await call("POST", "/playbooks", {
    name,
    body: "x".repeat(262144),
  });
  assert.equal(res.status, 200);
  const del = await call("DELETE", `/playbooks/${"n".repeat(80)}`);
  assert.equal(del.status, 200);
  const emoji = await call("POST", "/playbooks", {
    name: "😀".repeat(40),
    body: validBody,
  });
  assert.equal(emoji.status, 200);
  const multibyte = await call("POST", "/playbooks", {
    name: "Multibyte",
    body: "é".repeat(131072),
  });
  assert.equal(multibyte.status, 200);
});

test("PUT /playbooks/:slug covers slug, body, not-found, conflict and success", async () => {
  await call("POST", "/playbooks", { name: "Gamma", body: validBody });
  await expectError(
    "PUT",
    "/playbooks/Bad_Slug",
    { name: "X", body: validBody },
    400,
    "invalid-slug",
  );
  await expectError(
    "PUT",
    "/playbooks/-lead",
    { name: "X", body: validBody },
    400,
    "invalid-slug",
  );
  await expectError(
    "PUT",
    "/playbooks/Bad_Slug",
    { name: "", body: 5 },
    400,
    "invalid-slug",
  );
  await expectError(
    "PUT",
    "/playbooks/gamma",
    { name: "", body: validBody },
    400,
    "invalid-name",
  );
  await expectError(
    "PUT",
    "/playbooks/gamma",
    { name: "Gamma" },
    400,
    "invalid-body",
  );
  await expectError(
    "PUT",
    "/playbooks/missing",
    { name: "X", body: validBody },
    404,
    "not-found",
  );
  await expectError(
    "PUT",
    "/playbooks/gamma",
    { name: "Alpha", body: validBody },
    409,
    "name-exists",
  );
  await expectError(
    "PUT",
    "/playbooks/gamma",
    { name: "Gamma", body: "DISPATCH_STATUS: DONE - x" },
    400,
    "footgun",
  );
  const ok = await call("PUT", "/playbooks/gamma", {
    name: "Gamma Two",
    body: validBody,
  });
  assert.equal(ok.status, 200);
  const json = JSON.parse(ok.text) as { playbook: { name: string } };
  assert.equal(json.playbook.name, "Gamma Two");
});

test("DELETE /playbooks/:slug covers slug, not-found and success", async () => {
  await expectError(
    "DELETE",
    "/playbooks/Bad_Slug",
    undefined,
    400,
    "invalid-slug",
  );
  await expectError(
    "DELETE",
    "/playbooks/missing",
    undefined,
    404,
    "not-found",
  );
  await call("POST", "/playbooks", { name: "Delta", body: validBody });
  const ok = await call("DELETE", "/playbooks/delta");
  assert.equal(ok.status, 200);
  assert.equal(ok.text, JSON.stringify({ ok: true }));
});

test("write failures answer a generic 500", async () => {
  await call("POST", "/playbooks", { name: "Epsilon", body: validBody });
  fs.chmodSync(playbooksDir, 0o500);
  try {
    await expectError(
      "POST",
      "/playbooks",
      { name: "Zeta", body: validBody },
      500,
      "playbook-write-failed",
    );
    await expectError(
      "PUT",
      "/playbooks/epsilon",
      { name: "Epsilon", body: "Changed.\n" },
      500,
      "playbook-write-failed",
    );
    await expectError(
      "DELETE",
      "/playbooks/epsilon",
      undefined,
      500,
      "playbook-write-failed",
    );
  } finally {
    fs.chmodSync(playbooksDir, 0o700);
  }
});

test("POST /playbooks/generate validates direction first, then sources", async () => {
  const cases: [unknown, string][] = [
    [undefined, "invalid-direction"],
    [{}, "invalid-direction"],
    [{ direction: 5 }, "invalid-direction"],
    [{ direction: "   " }, "invalid-direction"],
    [{ direction: "x".repeat(10001) }, "invalid-direction"],
    [{ direction: "😀".repeat(5001) }, "invalid-direction"],
    [{ direction: "Write one", sourcePaths: null }, "invalid-sources"],
    [{ direction: "", sourcePaths: 5 }, "invalid-direction"],
    [{ direction: "Write one", sourcePaths: "a" }, "invalid-sources"],
    [{ direction: "Write one", sourcePaths: [1] }, "invalid-sources"],
    [
      { direction: "Write one", sourcePaths: Array(9).fill("a") },
      "invalid-sources",
    ],
  ];
  for (const [body, code] of cases) {
    await expectError("POST", "/playbooks/generate", body, 400, code);
  }
});

test("POST /playbooks/generate answers the draft", async () => {
  process.env.PLAYBOOK_STUB_MODE = "answer";
  const source = path.join(env.home, "notes.md");
  fs.writeFileSync(source, "Some notes.\n");
  const res = await call("POST", "/playbooks/generate", {
    direction: "x".repeat(10000),
    sourcePaths: Array(8).fill(source),
  });
  assert.equal(res.status, 200);
  assert.equal(res.text, JSON.stringify({ draft: "Stub draft" }));
});

test("POST /playbooks/generate rejects a source outside the home folder", async () => {
  process.env.PLAYBOOK_STUB_MODE = "answer";
  await expectError(
    "POST",
    "/playbooks/generate",
    { direction: "Write one", sourcePaths: ["/etc/hosts"] },
    400,
    "source-unreadable",
  );
});

test("POST /playbooks/generate answers 502 when the model run fails or is empty", async () => {
  process.env.PLAYBOOK_STUB_MODE = "fail";
  await expectError(
    "POST",
    "/playbooks/generate",
    { direction: "Write one" },
    502,
    "generate-failed",
  );
  process.env.PLAYBOOK_STUB_MODE = "empty";
  await expectError(
    "POST",
    "/playbooks/generate",
    { direction: "Write one" },
    502,
    "generate-failed",
  );
});

test("POST /playbooks/generate refuses a second run while one is in flight", async () => {
  process.env.PLAYBOOK_STUB_MODE = "sleep";
  const first = call("POST", "/playbooks/generate", { direction: "First" });
  await waitFor(
    () =>
      Promise.resolve(
        fs.existsSync(pidFile) &&
          fs.readFileSync(pidFile, "utf8").trim() !== "",
      ),
    5000,
    "stub pid file",
  );
  const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
  assert.ok(pid > 0);
  try {
    await expectError(
      "POST",
      "/playbooks/generate",
      { direction: "Second" },
      409,
      "generate-in-progress",
    );
    await expectError(
      "POST",
      "/playbooks/generate",
      { direction: "   " },
      400,
      "invalid-direction",
    );
    await expectError(
      "POST",
      "/playbooks/generate",
      { direction: "Second", sourcePaths: "a" },
      400,
      "invalid-sources",
    );
  } finally {
    process.kill(pid, "SIGKILL");
  }
  const firstRes = await first;
  assert.equal(firstRes.status, 502);
  assert.equal(firstRes.text, JSON.stringify({ error: "generate-failed" }));
  process.env.PLAYBOOK_STUB_MODE = "answer";
  const again = await call("POST", "/playbooks/generate", {
    direction: "Third",
  });
  assert.equal(again.status, 200);
});
