import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-setup-"));
process.env.HOME = home;
const { CONFIG_PATH } = await import("../services/infra/paths.js");
assert.ok(CONFIG_PATH.startsWith(home), "CONFIG_PATH escaped the temp HOME");
fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
const BASE = {
  port: 4799,
  workspaceRoot: path.join(home, "workspaces"),
  statusChannel: "auto",
  updateCheck: false,
  claudeArgs: "--model sonnet",
};
fs.writeFileSync(CONFIG_PATH, JSON.stringify(BASE, null, 2) + "\n", {
  mode: 0o600,
});

const express = (await import("express")).default;
const { setupRouter } = await import("./setup.route.js");
const { getOrchestrationConfig, setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
setOrchestrationConfig({ linearApiKey: "" });

const app = express();
app.use("/api", express.json(), setupRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
const onDisk = () =>
  JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
const status = async () =>
  (await (await fetch(`${base}/setup`)).json()) as {
    needsKey: boolean;
    onboardingDone: boolean;
  };
const markDone = () =>
  fetch(`${base}/setup/onboarding-done`, { method: "POST" });

after(() => {
  server.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test("a fresh config reports needsKey and onboarding not done", async () => {
  const s = await status();
  assert.equal(s.needsKey, true);
  assert.equal(s.onboardingDone, false);
  assert.equal("onboardingDone" in onDisk(), false);
});

test("POST onboarding-done answers 204 twice and flips only the flag", async () => {
  const first = await markDone();
  assert.equal(first.status, 204);
  assert.equal(await first.text(), "");
  const second = await markDone();
  assert.equal(second.status, 204);
  assert.deepEqual(onDisk(), { ...BASE, onboardingDone: true });
  assert.equal((fs.statSync(CONFIG_PATH).mode & 0o777).toString(8), "600");
  const s = await status();
  assert.equal(s.onboardingDone, true);
  assert.equal(s.needsKey, true);
  assert.equal(getOrchestrationConfig()?.onboardingDone, true);
});

test("POST onboarding-done ignores its body and writes only the flag", async () => {
  const res = await fetch(`${base}/setup/onboarding-done`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      onboardingDone: false,
      port: 1,
      linearApiKey: "INJECTED",
      sources: { linear: { apiKey: "INJECTED" } },
    }),
  });
  assert.equal(res.status, 204);
  assert.deepEqual(onDisk(), { ...BASE, onboardingDone: true });
});

test("GET setup never returns the stored key and answers exactly five fields", async () => {
  setOrchestrationConfig({ linearApiKey: "lin_api_route_test_secret" });
  const raw = await (await fetch(`${base}/setup`)).text();
  assert.equal(raw.includes("lin_api_route_test_secret"), false);
  const body = JSON.parse(raw) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), [
    "needsKey",
    "node",
    "onboardingDone",
    "prerequisites",
    "storage",
  ]);
  assert.equal(body.needsKey, false);
});
