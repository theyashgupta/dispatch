import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-args-test-"));
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
const url = `http://127.0.0.1:${port}/api/config/claude-args`;
const put = (claudeArgs: unknown) =>
  fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claudeArgs }),
  });

after(() => {
  server.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test("PUT accepts a hostile but printable argument string and persists it", async () => {
  const value = "--append-system-prompt 'be terse; $(id) && echo pwned'";
  const res = await put(value);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { claudeArgs: value });
  assert.equal(
    (
      JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as {
        claudeArgs?: string;
      }
    ).claudeArgs,
    value,
  );
});

test("PUT rejects a control byte the shell's line editor would act on, and leaves config untouched", async () => {
  const before = fs.readFileSync(CONFIG_PATH, "utf8");
  for (const bad of ["\x15touch /tmp/x; #", "--flag\x04", "a\tb"]) {
    const res = await put(bad);
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /control/);
  }
  assert.equal(fs.readFileSync(CONFIG_PATH, "utf8"), before);
});
