import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const configPath = path.join(env.dispatchDir, "config.json");
const vaultJson = path.join(env.dispatchDir, "vault", "vault.json");
const TOKEN = ["g5", "fake", "sentry", "token"].join("-");

const express = (await import("express")).default;
const { connectionRouter } = await import("./connection.route.js");
const { setOrchestrationConfig, getOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { rebuildSources } = await import("../adapters/source-gateway.js");
const { stopPollers } = await import("../adapters/poller.js");
const { createKey, listKeys, readCurrent, clearValue, setValue } =
  await import("../services/infra/vault.js");

const app = express();
app.use("/api", express.json(), connectionRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
const realFetch = globalThis.fetch;

after(() => {
  server.close();
  env.cleanup();
});

let orgsAnswer: () => Response = () => json(200, orgs(1));
let sentryCalls = 0;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function orgs(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    slug: `org${i + 1}`,
    links: { regionUrl: "https://us.sentry.io" },
  }));
}

function writeConfig(sentry?: Record<string, unknown>): void {
  const value = {
    port: 4700,
    sources: {
      linear: { apiKey: "", filters: { teams: ["keep"] } },
      ...(sentry ? { sentry } : {}),
    },
  };
  fs.writeFileSync(configPath, JSON.stringify(value), { mode: 0o600 });
  setOrchestrationConfig({
    linearApiKey: "",
    sources: { linear: { apiKey: "" }, ...(sentry ? { sentry } : {}) },
  });
  rebuildSources(getOrchestrationConfig()!);
}

function sentryEnabledOnDisk(): unknown {
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    sources?: { sentry?: { enabled?: unknown } };
  };
  return parsed.sources?.sentry?.enabled;
}

async function vaultSnapshot(): Promise<string> {
  const keys = await listKeys();
  const values = await Promise.all(keys.map((k) => readCurrent(k.name)));
  const bytes = fs.existsSync(vaultJson)
    ? fs.readFileSync(vaultJson, "utf8")
    : "";
  return JSON.stringify({ bytes, values });
}

async function call(
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await realFetch(`${base}${route}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, text: await res.text() };
}

async function fillVault(): Promise<void> {
  if ((await listKeys()).some((k) => k.name === "SENTRY_TOKEN")) {
    await setValue("SENTRY_TOKEN", TOKEN);
  } else {
    await createKey({ name: "SENTRY_TOKEN", purpose: "p", value: TOKEN });
  }
}

beforeEach(async () => {
  sentryCalls = 0;
  orgsAnswer = () => json(200, orgs(1));
  if ((await listKeys()).some((k) => k.name === "SENTRY_TOKEN")) {
    await clearValue("SENTRY_TOKEN");
  }
  writeConfig();
  mock.method(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (new URL(url).hostname === "sentry.io") {
        sentryCalls += 1;
        const auth = new Headers(init?.headers).get("authorization");
        if (auth !== `Bearer ${TOKEN}`) return Promise.resolve(json(401, {}));
        return Promise.resolve(orgsAnswer());
      }
      if (new URL(url).hostname === "api.github.com") {
        return Promise.resolve(json(401, {}));
      }
      return realFetch(input, init);
    },
  );
});

afterEach(() => {
  stopPollers();
  mock.restoreAll();
});

test("GET with no Vault value answers unconfigured and calls nobody", async () => {
  const res = await call("GET", "/sources/sentry/connection");
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.text), {
    configured: false,
    connected: false,
    enabled: false,
  });
  assert.equal(sentryCalls, 0);
});

test("GET connected names one org as the account", async () => {
  await fillVault();
  writeConfig({ enabled: true });
  const res = await call("GET", "/sources/sentry/connection");
  assert.deepEqual(JSON.parse(res.text), {
    configured: true,
    connected: true,
    enabled: true,
    via: "vault",
    account: "org1",
  });
});

test("GET names three orgs and counts the rest when there are five", async () => {
  await fillVault();
  writeConfig({ enabled: true });
  orgsAnswer = () => json(200, orgs(5));
  const body = JSON.parse(
    (await call("GET", "/sources/sentry/connection")).text,
  ) as {
    configured?: boolean;
    connected?: boolean;
    enabled?: boolean;
    account?: string;
    error?: string;
  };
  assert.equal(body.account, "org1, org2, org3 +2");
});

test("GET with a filled value but no consent is configured, not connected", async () => {
  await fillVault();
  const body = JSON.parse(
    (await call("GET", "/sources/sentry/connection")).text,
  ) as {
    configured?: boolean;
    connected?: boolean;
    enabled?: boolean;
    account?: string;
    error?: string;
  };
  assert.equal(body.configured, true);
  assert.equal(body.connected, false);
  assert.equal(body.enabled, false);
});

test("GET reports a rejected token", async () => {
  await fillVault();
  writeConfig({ enabled: true });
  orgsAnswer = () => json(401, {});
  const body = JSON.parse(
    (await call("GET", "/sources/sentry/connection")).text,
  ) as {
    configured?: boolean;
    connected?: boolean;
    enabled?: boolean;
    account?: string;
    error?: string;
  };
  assert.equal(body.connected, false);
  assert.equal(body.error, "rejected");
});

test("POST connect with a Vault value enables Sentry", async () => {
  await fillVault();
  const res = await call("POST", "/sources/sentry/connect");
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.text), { account: "org1", via: "vault" });
  assert.equal(sentryEnabledOnDisk(), true);
  assert.ok(!res.text.includes(TOKEN));
});

test("POST connect without a Vault value refuses and enables nothing", async () => {
  const res = await call("POST", "/sources/sentry/connect");
  assert.equal(res.status, 400);
  assert.deepEqual(JSON.parse(res.text), { error: "no-credential" });
  assert.equal(sentryEnabledOnDisk(), undefined);
  assert.equal(sentryCalls, 0);
});

test("PUT with a blank key answers 400 and calls nobody", async () => {
  const before = await vaultSnapshot();
  const res = await call("PUT", "/sources/sentry/key", { apiKey: "   " });
  assert.equal(res.status, 400);
  assert.equal(sentryCalls, 0);
  assert.equal(await vaultSnapshot(), before);
});

test("PUT with a rejected token leaves the Vault and config byte-identical", async () => {
  const before = await vaultSnapshot();
  const configBefore = fs.readFileSync(configPath, "utf8");
  const res = await call("PUT", "/sources/sentry/key", {
    apiKey: ["other", "sentry", "token"].join("-"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(JSON.parse(res.text), { error: "rejected" });
  assert.equal(await vaultSnapshot(), before);
  assert.equal(fs.readFileSync(configPath, "utf8"), configBefore);
});

test("PUT while Sentry is unreachable leaves the Vault and config byte-identical", async () => {
  const before = await vaultSnapshot();
  const configBefore = fs.readFileSync(configPath, "utf8");
  orgsAnswer = () => json(503, {});
  const res = await call("PUT", "/sources/sentry/key", { apiKey: TOKEN });
  assert.equal(res.status, 502);
  assert.deepEqual(JSON.parse(res.text), { error: "unreachable" });
  assert.equal(await vaultSnapshot(), before);
  assert.equal(fs.readFileSync(configPath, "utf8"), configBefore);
});

test("PUT with a valid token stores it with the purpose and enables Sentry", async () => {
  const res = await call("PUT", "/sources/sentry/key", { apiKey: TOKEN });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.text), { account: "org1", via: "vault" });
  assert.deepEqual(await readCurrent("SENTRY_TOKEN"), {
    ok: true,
    value: TOKEN,
  });
  const key = (await listKeys()).find((k) => k.name === "SENTRY_TOKEN");
  assert.equal(key?.filled, true);
  assert.equal(sentryEnabledOnDisk(), true);
  assert.ok(!res.text.includes(TOKEN));
});

test("DELETE clears the value, keeps the key and every other key, and disables", async () => {
  await createKey({ name: "OTHER_KEY", purpose: "other", value: "keep-me" });
  await fillVault();
  writeConfig({ enabled: true });
  const res = await call("DELETE", "/sources/sentry/key");
  assert.equal(res.status, 204);
  const keys = await listKeys();
  assert.equal(keys.find((k) => k.name === "SENTRY_TOKEN")?.filled, false);
  assert.deepEqual(await readCurrent("OTHER_KEY"), {
    ok: true,
    value: "keep-me",
  });
  assert.equal(sentryEnabledOnDisk(), false);
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    sources: { linear: { filters: unknown } };
  };
  assert.deepEqual(parsed.sources.linear.filters, { teams: ["keep"] });
});

test("the GitHub and Linear branches still answer on their own paths", async () => {
  const github = await call("GET", "/sources/github/connection");
  assert.equal(github.status, 200);
  const linear = await call("GET", "/sources/linear/connection");
  assert.deepEqual(JSON.parse(linear.text), {
    configured: false,
    connected: false,
  });
  assert.equal(sentryCalls, 0);
});

test("no Sentry route writes the token to the console", async () => {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  mock.method(console, "log", capture);
  mock.method(console, "error", capture);
  mock.method(console, "warn", capture);
  await call("PUT", "/sources/sentry/key", { apiKey: TOKEN });
  await call("GET", "/sources/sentry/connection");
  await call("POST", "/sources/sentry/connect");
  await call("DELETE", "/sources/sentry/key");
  assert.ok(lines.every((line) => !line.includes(TOKEN)));
});
