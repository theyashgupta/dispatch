import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-profile-"));
process.env.HOME = home;
const { CONFIG_PATH } = await import("../services/infra/paths.js");
assert.ok(CONFIG_PATH.startsWith(home), "CONFIG_PATH escaped the temp HOME");
fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
const BASE = {
  port: 4799,
  claudeArgs: "--model sonnet",
  sources: { linear: { apiKey: "k", filters: { currentCycle: true } } },
};
fs.writeFileSync(CONFIG_PATH, JSON.stringify(BASE, null, 2) + "\n", {
  mode: 0o600,
});

const express = (await import("express")).default;
const { profileRouter } = await import("./profile.route.js");
const { getOrchestrationConfig, setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
setOrchestrationConfig({ linearApiKey: "k" });

const app = express();
app.use("/api", express.json(), profileRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/config/profile`;
const sha = () =>
  createHash("sha256").update(fs.readFileSync(CONFIG_PATH)).digest("hex");
const onDisk = () =>
  JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
const put = (body: unknown) =>
  fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

after(() => {
  server.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test("GET with nothing stored returns an empty profile", async () => {
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {});
});

test("PUT valid returns the normalized profile, writes it, keeps every other key and GET serves it", async () => {
  const res = await put({
    name: " Ada ",
    email: "ada@x.dev",
    handles: ["@ada", " @ada", "ada-gh"],
    role: "",
    brief: "Ships the board.",
  });
  assert.equal(res.status, 200);
  const expected = {
    name: "Ada",
    email: "ada@x.dev",
    handles: ["@ada", "ada-gh"],
    brief: "Ships the board.",
  };
  assert.deepEqual(await res.json(), expected);
  assert.deepEqual(onDisk(), { ...BASE, profile: expected });
  assert.equal(fs.statSync(CONFIG_PATH).mode & 0o777, 0o600);
  assert.deepEqual(getOrchestrationConfig()?.profile, expected);
  assert.deepEqual(await (await fetch(url)).json(), expected);
});

test("PUT invalid answers 400 with the field named and leaves the file byte-identical", async () => {
  const before = sha();
  for (const body of [
    { brief: "a".repeat(4001) },
    { handles: "@ada" },
    { name: "a".repeat(201) },
    [],
  ]) {
    const res = await put(body);
    assert.equal(res.status, 400);
    assert.ok(((await res.json()) as { error: string }).error.length > 0);
    assert.equal(sha(), before);
  }
});

test("PUT with every field blank removes the profile key and keeps the rest", async () => {
  const res = await put({ name: " ", handles: [] });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {});
  assert.deepEqual(onDisk(), BASE);
});
