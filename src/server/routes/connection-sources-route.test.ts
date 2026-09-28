import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const configPath = path.join(env.dispatchDir, "config.json");
const ghPath = path.join(env.binDir, "gh");
const GH_TOKEN = ["g5", "fake", "gh", "token"].join("-");
const VAULT_TOKEN = ["g5", "fake", "vault", "token"].join("-");

const express = (await import("express")).default;
const { connectionRouter } = await import("./connection.route.js");
const { setOrchestrationConfig, getOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { rebuildSources } = await import("../adapters/source-gateway.js");
const { stopPollers } = await import("../adapters/poller.js");
const { createKey, listKeys, readCurrent, clearValue } =
  await import("../services/domain/vault.js");

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

type GithubAnswer = (token: string) => Response;

let githubAnswer: GithubAnswer = () => json(200, { login: "g5-tester" });
let githubCalls = 0;

function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function ghShim(token: string | null): void {
  fs.writeFileSync(
    ghPath,
    token === null
      ? "#!/bin/sh\nexit 1\n"
      : `#!/bin/sh\n[ "$1 $2" = "auth token" ] && echo ${token} && exit 0\nexit 1\n`,
    { mode: 0o755 },
  );
}

function writeConfig(github?: Record<string, unknown>): void {
  const value = {
    port: 4700,
    sources: {
      linear: { apiKey: "", filters: { teams: ["keep"] } },
      ...(github ? { github } : {}),
    },
  };
  fs.writeFileSync(configPath, JSON.stringify(value), { mode: 0o600 });
  setOrchestrationConfig({
    linearApiKey: "",
    sources: { linear: { apiKey: "" }, ...(github ? { github } : {}) },
  });
  rebuildSources(getOrchestrationConfig()!);
}

function githubEnabledOnDisk(): unknown {
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    sources?: { github?: { enabled?: unknown } };
  };
  return parsed.sources?.github?.enabled;
}

async function vaultSnapshot(): Promise<string> {
  const keys = await listKeys();
  const values = await Promise.all(keys.map((k) => readCurrent(k.name)));
  return JSON.stringify({
    keys: keys.map((k) => [k.name, k.purpose, k.filled]),
    values,
  });
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

beforeEach(async () => {
  githubCalls = 0;
  githubAnswer = () => json(200, { login: "g5-tester" });
  ghShim(null);
  if ((await listKeys()).some((k) => k.name === "GITHUB_TOKEN")) {
    await clearValue("GITHUB_TOKEN");
  }
  writeConfig();
  mock.method(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (new URL(url).hostname === "api.github.com") {
        githubCalls += 1;
        const headers = new Headers(init?.headers);
        const token = (headers.get("authorization") ?? "").replace(
          "Bearer ",
          "",
        );
        if (url.includes("/search/issues")) {
          return Promise.resolve(
            json(200, { total_count: 0, incomplete_results: false, items: [] }),
          );
        }
        return Promise.resolve(githubAnswer(token));
      }
      return realFetch(input, init);
    },
  );
});

afterEach(() => {
  stopPollers();
  mock.restoreAll();
});

test("GET with no credential answers unconfigured and calls nobody", async () => {
  const res = await call("GET", "/sources/github/connection");
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.text), {
    configured: false,
    connected: false,
    enabled: false,
  });
  assert.equal(githubCalls, 0);
});

test("GET with the gh login and enabled true answers connected via gh", async () => {
  ghShim(GH_TOKEN);
  writeConfig({ enabled: true });
  const res = await call("GET", "/sources/github/connection");
  assert.deepEqual(JSON.parse(res.text), {
    configured: true,
    connected: true,
    enabled: true,
    via: "gh",
    account: "g5-tester",
  });
  assert.ok(!res.text.includes(GH_TOKEN));
});

test("GET with a credential but no consent answers configured, not connected", async () => {
  ghShim(GH_TOKEN);
  const res = await call("GET", "/sources/github/connection");
  assert.deepEqual(JSON.parse(res.text), {
    configured: true,
    connected: false,
    enabled: false,
    via: "gh",
    account: "g5-tester",
  });
});

test("GET prefers a filled Vault value and names it", async () => {
  ghShim(GH_TOKEN);
  await createKey({ name: "GITHUB_TOKEN", purpose: "p", value: VAULT_TOKEN });
  writeConfig({ enabled: true });
  let seen = "";
  githubAnswer = (token) => {
    seen = token;
    return json(200, { login: "vault-user" });
  };
  const res = await call("GET", "/sources/github/connection");
  assert.equal((JSON.parse(res.text) as { via?: string }).via, "vault");
  assert.equal(seen, VAULT_TOKEN);
});

test("GET reports a rejected credential", async () => {
  ghShim(GH_TOKEN);
  githubAnswer = () => json(401, { message: "Bad credentials" });
  const res = await call("GET", "/sources/github/connection");
  assert.deepEqual(JSON.parse(res.text), {
    configured: true,
    connected: false,
    enabled: false,
    via: "gh",
    error: "rejected",
  });
});

test("GET reports an outage as unreachable, never rejected", async () => {
  ghShim(GH_TOKEN);
  githubAnswer = () => json(502, {});
  const res = await call("GET", "/sources/github/connection");
  assert.equal(
    (JSON.parse(res.text) as { error?: string }).error,
    "unreachable",
  );
});

test("GET reports an SSO block with its authorization URL", async () => {
  ghShim(GH_TOKEN);
  githubAnswer = () =>
    json(
      403,
      { message: "SAML" },
      {
        "x-github-sso": "required; url=https://github.com/orgs/acme/sso?x=1",
      },
    );
  const res = await call("GET", "/sources/github/connection");
  assert.deepEqual(JSON.parse(res.text), {
    configured: true,
    connected: false,
    enabled: false,
    via: "gh",
    error: "sso-required",
    ssoUrl: "https://github.com/orgs/acme/sso?x=1",
  });
});

test("POST connect with the gh login enables the source", async () => {
  ghShim(GH_TOKEN);
  const res = await call("POST", "/sources/github/connect");
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.text), { account: "g5-tester", via: "gh" });
  assert.equal(githubEnabledOnDisk(), true);
  assert.equal(getOrchestrationConfig()?.sources?.github?.enabled, true);
  assert.ok(!res.text.includes(GH_TOKEN));
});

test("POST connect that a DELETE overtakes answers superseded and stays disabled", async () => {
  fs.writeFileSync(
    ghPath,
    `#!/bin/sh\nsleep 0.5\n[ "$1 $2" = "auth token" ] && echo ${GH_TOKEN} && exit 0\nexit 1\n`,
    { mode: 0o755 },
  );
  const connecting = call("POST", "/sources/github/connect");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await call("DELETE", "/sources/github/key")).status, 204);
  const res = await connecting;
  assert.equal(res.status, 409);
  assert.deepEqual(JSON.parse(res.text), { error: "superseded" });
  assert.equal(githubEnabledOnDisk(), false);
});

test("PUT that a DELETE overtakes answers superseded and stores nothing", async () => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  mock.restoreAll();
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (new URL(url).hostname === "api.github.com") {
        await held;
        return json(200, { login: "g5-tester" });
      }
      return realFetch(input, init);
    },
  );
  const saving = call("PUT", "/sources/github/key", { apiKey: VAULT_TOKEN });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await call("DELETE", "/sources/github/key")).status, 204);
  release();
  const res = await saving;
  assert.equal(res.status, 409);
  assert.deepEqual(JSON.parse(res.text), { error: "superseded" });
  assert.equal(githubEnabledOnDisk(), false);
  assert.deepEqual(await readCurrent("GITHUB_TOKEN"), {
    ok: false,
    error: "not-found",
  });
});

test("PUT with an unreadable config answers save-failed and stores no token", async () => {
  fs.writeFileSync(configPath, "{ not json", { mode: 0o600 });
  const res = await call("PUT", "/sources/github/key", { apiKey: VAULT_TOKEN });
  assert.equal(res.status, 500);
  assert.deepEqual(JSON.parse(res.text), { error: "save-failed" });
  assert.deepEqual(await readCurrent("GITHUB_TOKEN"), {
    ok: false,
    error: "not-found",
  });
});

test("POST connect without any credential refuses and enables nothing", async () => {
  const res = await call("POST", "/sources/github/connect");
  assert.equal(res.status, 400);
  assert.deepEqual(JSON.parse(res.text), { error: "no-credential" });
  assert.equal(githubEnabledOnDisk(), undefined);
});

test("POST connect with a rejected credential refuses and enables nothing", async () => {
  ghShim(GH_TOKEN);
  githubAnswer = () => json(401, {});
  const res = await call("POST", "/sources/github/connect");
  assert.equal(res.status, 400);
  assert.equal(githubEnabledOnDisk(), undefined);
});

test("PUT with a blank key answers 400", async () => {
  const res = await call("PUT", "/sources/github/key", { apiKey: "  " });
  assert.equal(res.status, 400);
  assert.equal(githubCalls, 0);
});

test("PUT with a rejected token writes nothing", async () => {
  const before = await vaultSnapshot();
  githubAnswer = () => json(401, {});
  const res = await call("PUT", "/sources/github/key", { apiKey: VAULT_TOKEN });
  assert.equal(res.status, 400);
  assert.deepEqual(JSON.parse(res.text), { error: "rejected" });
  assert.equal(await vaultSnapshot(), before);
  assert.equal(githubEnabledOnDisk(), undefined);
});

test("PUT while GitHub is unreachable writes nothing", async () => {
  const before = await vaultSnapshot();
  githubAnswer = () => json(503, {});
  const res = await call("PUT", "/sources/github/key", { apiKey: VAULT_TOKEN });
  assert.equal(res.status, 502);
  assert.equal(await vaultSnapshot(), before);
  assert.equal(githubEnabledOnDisk(), undefined);
});

test("PUT with a valid token stores it in the Vault and enables the source", async () => {
  const res = await call("PUT", "/sources/github/key", { apiKey: VAULT_TOKEN });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.text), {
    account: "g5-tester",
    via: "vault",
  });
  assert.deepEqual(await readCurrent("GITHUB_TOKEN"), {
    ok: true,
    value: VAULT_TOKEN,
  });
  assert.equal(githubEnabledOnDisk(), true);
  assert.ok(!res.text.includes(VAULT_TOKEN));
});

test("DELETE clears the value, keeps the key and every other key, and disables", async () => {
  await call("PUT", "/sources/github/key", { apiKey: VAULT_TOKEN });
  if (!(await listKeys()).some((k) => k.name === "OTHER_KEY")) {
    await createKey({ name: "OTHER_KEY", purpose: "o", value: "stay" });
  }
  const res = await call("DELETE", "/sources/github/key");
  assert.equal(res.status, 204);
  const keys = await listKeys();
  assert.equal(keys.find((k) => k.name === "GITHUB_TOKEN")?.filled, false);
  assert.deepEqual(await readCurrent("OTHER_KEY"), {
    ok: true,
    value: "stay",
  });
  assert.equal(githubEnabledOnDisk(), false);
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    sources: { linear: unknown };
  };
  assert.deepEqual(parsed.sources.linear, {
    apiKey: "",
    filters: { teams: ["keep"] },
  });
});

test("Linear keeps its own path: no key answers unconfigured with no GitHub call", async () => {
  const res = await call("GET", "/sources/linear/connection");
  assert.deepEqual(JSON.parse(res.text), {
    configured: false,
    connected: false,
  });
  assert.equal(githubCalls, 0);
});

test("connect is refused for Linear and for an unknown source", async () => {
  assert.equal((await call("POST", "/sources/linear/connect")).status, 404);
  assert.equal((await call("POST", "/sources/nope/connect")).status, 404);
  assert.equal((await call("GET", "/sources/nope/connection")).status, 404);
});

test("no connection route writes a token to the console", async () => {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  mock.method(console, "log", capture);
  mock.method(console, "error", capture);
  mock.method(console, "warn", capture);
  ghShim(GH_TOKEN);
  await call("GET", "/sources/github/connection");
  await call("POST", "/sources/github/connect");
  await call("PUT", "/sources/github/key", { apiKey: VAULT_TOKEN });
  githubAnswer = () => json(401, {});
  await call("PUT", "/sources/github/key", { apiKey: VAULT_TOKEN });
  await call("DELETE", "/sources/github/key");
  assert.ok(
    lines.every(
      (line) => !line.includes(GH_TOKEN) && !line.includes(VAULT_TOKEN),
    ),
  );
});
