import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const { CONFIG_PATH, HOOK_SETTINGS_PATH, hookSettingsPath } =
  await import("../services/infra/paths.js");
const express = (await import("express")).default;
const { boardRouter } = await import("./board.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
setOrchestrationConfig({ linearApiKey: "" });

const app = express();
app.use("/api", express.json(), boardRouter, httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/config/cross-session-inbound`;
after(() => {
  server.close();
  env.cleanup();
});

const put = (body: unknown) =>
  fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const configValue = () =>
  (
    JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as {
      crossSessionInbound?: string;
    }
  ).crossSessionInbound;

void test("GET answers accept when nothing is stored", async () => {
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { crossSessionInbound: "accept" });
});

void test("PUT hold stores it, rewrites the settings files and GET reads it back", async () => {
  const res = await put({ crossSessionInbound: "hold" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { crossSessionInbound: "hold" });
  assert.deepEqual(await (await fetch(url)).json(), {
    crossSessionInbound: "hold",
  });
  assert.equal(configValue(), "hold");
  assert.match(
    fs.readFileSync(HOOK_SETTINGS_PATH, "utf8"),
    /"crossSessionInbound": "hold"/,
  );
  for (const value of ["accept", "hold", "refuse"] as const) {
    assert.match(
      fs.readFileSync(hookSettingsPath(value), "utf8"),
      new RegExp(`"crossSessionInbound": "${value}"`),
    );
  }
});

void test("PUT with an unknown value answers 400 and changes nothing", async () => {
  const configBefore = fs.readFileSync(CONFIG_PATH, "utf8");
  const settingsBefore = fs.readFileSync(HOOK_SETTINGS_PATH, "utf8");
  for (const body of [
    { crossSessionInbound: "bogus" },
    { crossSessionInbound: null },
    {},
  ]) {
    const res = await put(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(await res.json(), {
      error: "crossSessionInbound must be one of accept, hold, refuse",
    });
  }
  assert.equal(fs.readFileSync(CONFIG_PATH, "utf8"), configBefore);
  assert.equal(fs.readFileSync(HOOK_SETTINGS_PATH, "utf8"), settingsBefore);
  assert.deepEqual(await (await fetch(url)).json(), {
    crossSessionInbound: "hold",
  });
});
