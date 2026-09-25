import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-sse-profile-"));
process.env.HOME = home;
const { CONFIG_PATH } = await import("../services/infra/paths.js");
assert.ok(CONFIG_PATH.startsWith(home), "CONFIG_PATH escaped the temp HOME");

const express = (await import("express")).default;
const { sseRouter } = await import("./sse.route.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");

const NAME = "Zephyrine Profile-Probe";
setOrchestrationConfig({
  linearApiKey: "k",
  profile: { name: NAME, email: "zephyrine@probe.test", handles: ["@zeph"] },
});

const app = express();
app.use("/api", sseRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

after(() => {
  server.close();
  server.closeAllConnections();
  fs.rmSync(home, { recursive: true, force: true });
});

test("the board snapshot frame on the SSE stream never carries the profile", async () => {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/stream`, { signal: controller.signal });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  let text = "";
  while (!text.includes("\n\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  controller.abort();
  assert.match(text, /^data: \{/);
  for (const needle of [NAME, "zephyrine@probe.test", "@zeph", '"profile"']) {
    assert.ok(!text.includes(needle), `frame carries ${needle}`);
  }
});
