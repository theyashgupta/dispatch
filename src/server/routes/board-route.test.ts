import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { DEFAULT_TERMINAL_APPEARANCE } from "../../shared/terminal-appearance.js";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-route-test-"));
process.env.HOME = home;
const { CONFIG_PATH } = await import("../services/infra/paths.js");
assert.ok(CONFIG_PATH.startsWith(home), "CONFIG_PATH escaped the temp HOME");
fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
fs.writeFileSync(
  CONFIG_PATH,
  JSON.stringify({ sources: { linear: { apiKey: "k" } }, port: 4799 }),
);
const express = (await import("express")).default;
const { boardRouter } = await import("./board.route.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
setOrchestrationConfig({ linearApiKey: "k" });

const app = express();
app.use("/api", express.json(), boardRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const port = (server.address() as { port: number }).port;
const url = `http://127.0.0.1:${port}/api/config/terminal`;
const sha = () =>
  createHash("sha256").update(fs.readFileSync(CONFIG_PATH)).digest("hex");

after(() => {
  server.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test("GET serves the defaults when nothing is persisted", async () => {
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), DEFAULT_TERMINAL_APPEARANCE);
});

test("PUT with an invalid body is rejected and the file is untouched", async () => {
  const before = sha();
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...DEFAULT_TERMINAL_APPEARANCE, fontSize: 40 }),
  });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /^fontSize/);
  assert.equal(sha(), before);
});

test("PUT with a valid body persists it and GET serves it live", async () => {
  const custom = { ...DEFAULT_TERMINAL_APPEARANCE, background: "#223344" };
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(custom),
  });
  assert.equal(res.status, 200);
  const written = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as {
    terminal: unknown;
    port: number;
  };
  assert.deepEqual(written.terminal, custom);
  assert.equal(written.port, 4799);
  assert.deepEqual(await (await fetch(url)).json(), custom);
});
