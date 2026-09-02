import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const configHolder = await import("../services/infra/config-holder.js");
const accounts = await import("../services/domain/claude-accounts.js");
const { accountsRouter } = await import("./accounts.route.js");

configHolder.setOrchestrationConfig({ linearApiKey: "", port: 4700 });

const app = express();
app.use(express.json());
app.use("/api", accountsRouter);
const server = app.listen(0);
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}/api`;

const ID_A = "11111111-1111-4111-8111-111111111111";
const configPath = path.join(env.dispatchDir, "config.json");

function readConfig(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
    string,
    unknown
  >;
}

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

void test.after(() => {
  server.close();
  for (const restore of fetchRestores) restore();
  env.cleanup();
});

void test("GET /accounts lists Default first with the CLI identity and no token fields", async () => {
  const { status, body } = await call("GET", "/accounts");
  assert.equal(status, 200);
  assert.equal(body.activeId, "default");
  const list = body.accounts as {
    id: string;
    email: string;
    isDefault: boolean;
  }[];
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "default");
  assert.equal(list[0].email, "home@example.com");
  assert.equal(list[0].isDefault, true);
  assert.doesNotMatch(JSON.stringify(body), /accessToken|refreshToken|sk-ant-/);
});

void test("PUT /accounts/active with an unknown id is 404 and config is byte-identical", async () => {
  const before = fs.readFileSync(configPath, "utf8");
  const missing = await call("PUT", "/accounts/active", {
    id: "33333333-3333-4333-8333-333333333333",
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "not-found");
  const invalid = await call("PUT", "/accounts/active", { id: "../etc" });
  assert.equal(invalid.status, 400);
  const empty = await call("PUT", "/accounts/active", {});
  assert.equal(empty.status, 400);
  assert.equal(fs.readFileSync(configPath, "utf8"), before);
});

void test("DELETE /accounts/default is 400", async () => {
  const { status, body } = await call("DELETE", "/accounts/default");
  assert.equal(status, 400);
  assert.equal(body.error, "default-account");
});

void test("activate then remove an added account resets the active pointer", async () => {
  await accounts.upsertAccount({
    id: ID_A,
    email: "a@example.com",
    orgId: "org-a",
    orgName: "Org A",
    subscriptionType: "pro",
    createdAt: "2026-09-02T00:00:00.000Z",
    lastLoginAt: "2026-09-02T00:00:00.000Z",
  });
  await accounts.materializeConfigDir(ID_A);
  const activated = await call("PUT", "/accounts/active", { id: ID_A });
  assert.equal(activated.status, 200);
  assert.equal(activated.body.activeId, ID_A);
  assert.equal(readConfig().activeClaudeAccountId, ID_A);

  const listed = await call("GET", "/accounts");
  assert.equal((listed.body.accounts as unknown[]).length, 2);
  assert.equal(listed.body.activeId, ID_A);

  const removed = await call("DELETE", `/accounts/${ID_A}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.activeId, "default");
  assert.equal(fs.existsSync(accounts.accountDir(ID_A)), false);
  assert.equal("activeClaudeAccountId" in readConfig(), false);

  const again = await call("DELETE", `/accounts/${ID_A}`);
  assert.equal(again.status, 404);
});

void test("a malformed registry makes GET /accounts answer 500, never an empty list", async () => {
  const registry = path.join(
    env.dispatchDir,
    "claude-accounts",
    "accounts.json",
  );
  fs.writeFileSync(registry, '{"accounts":[{"nope":1}]}');
  const { status, body } = await call("GET", "/accounts");
  assert.equal(status, 500);
  assert.equal(body.error, "accounts-read-failed");
  fs.writeFileSync(registry, '{"version":1,"accounts":[]}');
});

async function waitForState(
  state: string,
  tries = 50,
): Promise<Record<string, unknown>> {
  for (let i = 0; i < tries; i++) {
    const { body } = await call("GET", "/accounts/login");
    if (body.state === state) return body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`login never reached ${state}`);
}

void test("login: start reaches awaiting-code with a url, second start is 409, code outside state is 409", async () => {
  const idle = await call("POST", "/accounts/login/code", { code: "x" });
  assert.equal(idle.status, 409);
  assert.equal(idle.body.error, "not-awaiting");

  const started = await call("POST", "/accounts/login", {});
  assert.equal(started.status, 202);
  const awaiting = await waitForState("awaiting-code");
  assert.match(String(awaiting.url), /^https:\/\/claude\.com\//);
  assert.equal(JSON.stringify(awaiting).includes("code=abc"), true);
  assert.doesNotMatch(
    JSON.stringify(awaiting),
    /accessToken|refreshToken|sk-ant-/,
  );

  const again = await call("POST", "/accounts/login", {});
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "in-flight");

  const empty = await call("POST", "/accounts/login/code", { code: "  " });
  assert.equal(empty.status, 400);

  const bad = await call("POST", "/accounts/login/code", { code: "bad" });
  assert.equal(bad.status, 200);
  const errored = await waitForState("error");
  assert.doesNotMatch(String(errored.message), /bad|sk-ant-/);
  const accountId = String(awaiting.accountId);
  assert.equal(fs.existsSync(accounts.accountDir(accountId)), false);
  assert.equal(
    (await accounts.readRegistry()).some((a) => a.id === accountId),
    false,
  );

  const cleared = await call("DELETE", "/accounts/login");
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.state, "idle");
});

void test("login: a good code lands in done and the account is listed; a duplicate is rejected", async () => {
  await call("POST", "/accounts/login", {});
  const awaiting = await waitForState("awaiting-code");
  const accountId = String(awaiting.accountId);
  assert.equal(
    fs
      .lstatSync(path.join(accounts.accountDir(accountId), "settings.json"))
      .isSymbolicLink(),
    true,
  );
  await call("POST", "/accounts/login/code", { code: "good" });
  const done = await waitForState("done");
  const account = done.account as {
    id: string;
    email: string;
    isDefault: boolean;
  };
  assert.equal(account.id, accountId);
  assert.equal(account.email, "second@example.com");
  assert.equal(account.isDefault, false);
  const listed = await call("GET", "/accounts");
  assert.equal(
    (listed.body.accounts as { id: string }[]).some((a) => a.id === accountId),
    true,
  );

  await call("POST", "/accounts/login", {});
  const awaiting2 = await waitForState("awaiting-code");
  const dupeId = String(awaiting2.accountId);
  const dupeDir = accounts.accountDir(dupeId);
  fs.writeFileSync(
    path.join(dupeDir, ".fake-login"),
    '{"loggedIn":true,"email":"second@example.com","orgId":"org-2","orgName":"Second Org","subscriptionType":"pro"}',
  );
  await call("POST", "/accounts/login/code", { code: "good" });
  const errored = await waitForState("error");
  assert.match(String(errored.message), /already added/);
  assert.equal(fs.existsSync(dupeDir), false);
  assert.equal((await accounts.readRegistry()).length, 1);

  const relogin = await call("POST", "/accounts/login", { accountId });
  assert.equal(relogin.status, 202);
  await waitForState("awaiting-code");
  await call("POST", "/accounts/login/code", { code: "good" });
  const redone = await waitForState("done");
  assert.equal((redone.account as { id: string }).id, accountId);
  assert.equal((await accounts.readRegistry()).length, 1);

  const unknown = await call("POST", "/accounts/login", {
    accountId: "33333333-3333-4333-8333-333333333333",
  });
  assert.equal(unknown.status, 404);
  const malformed = await call("POST", "/accounts/login", { accountId: "x" });
  assert.equal(malformed.status, 400);
});

void test("login: cancel kills a hung login and removes a fresh dir", async () => {
  await call("POST", "/accounts/login", {});
  const awaiting = await waitForState("awaiting-code");
  const dir = accounts.accountDir(String(awaiting.accountId));
  await call("POST", "/accounts/login/code", { code: "hang" });
  await waitForState("finishing");
  const cancelled = await call("DELETE", "/accounts/login");
  assert.equal(cancelled.body.state, "idle");
  assert.equal(fs.existsSync(dir), false);
});

const GRILL_PAYLOAD = {
  limits: [
    {
      kind: "session",
      percent: 53,
      resets_at: "2026-09-01T22:50:00Z",
      is_active: true,
    },
    {
      kind: "weekly_all",
      percent: 11,
      resets_at: "2026-09-08T03:00:00Z",
      is_active: false,
    },
  ],
};

const realFetch = globalThis.fetch;
const fetchRestores: (() => void)[] = [];
let lastAuthHeader: string | null = null;

function stubFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  let calls = 0;
  fetchRestores.push(() => {
    globalThis.fetch = realFetch;
  });
  globalThis.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (!url.includes("api.anthropic.com")) {
      return realFetch(input, init);
    }
    calls += 1;
    lastAuthHeader =
      (init?.headers as Record<string, string> | undefined)?.Authorization ??
      null;
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers }),
    );
  };
  return () => calls;
}

void test("usage: list carries a snapshot, refresh is limited to one call per 30 s, and no token leaks", async () => {
  const calls = stubFetch(200, GRILL_PAYLOAD);
  const first = await call("POST", "/accounts/default/usage/refresh");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const usage = first.body.usage as {
    status: string;
    windows: { kind: string; percent: number }[];
    fetchedAt: string;
  };
  assert.equal(usage.status, "ok");
  assert.deepEqual(
    usage.windows.map((w) => [w.kind, w.percent]),
    [
      ["session", 53],
      ["weekly_all", 11],
    ],
  );
  assert.ok(usage.fetchedAt);
  assert.doesNotMatch(
    JSON.stringify(first.body),
    /sk-ant-|accessToken|refreshToken/,
  );

  const second = await call("POST", "/accounts/default/usage/refresh");
  assert.equal(second.status, 429);
  assert.equal(second.body.error, "too-soon");
  assert.equal(calls(), 1);

  const listed = await call("GET", "/accounts");
  const def = (
    listed.body.accounts as { id: string; usage: { status: string } }[]
  ).find((a) => a.id === "default");
  assert.equal(def?.usage.status, "ok");
  assert.doesNotMatch(
    JSON.stringify(listed.body),
    /sk-ant-|accessToken|refreshToken/,
  );

  const unknown = await call(
    "POST",
    "/accounts/33333333-3333-4333-8333-333333333333/usage/refresh",
  );
  assert.equal(unknown.status, 404);
  const malformed = await call("POST", "/accounts/nope/usage/refresh");
  assert.equal(malformed.status, 400);
});

void test("usage: 401 keeps the old windows as stale, 429 honours Retry-After, missing token is unavailable", async () => {
  const domain = await import("../services/orchestration/claude-usage.js");
  stubFetch(401, { error: "unauthorized" });
  const stale = await domain.refreshUsage("default");
  assert.equal(stale.status, "stale");
  assert.equal(stale.windows.length, 2);

  stubFetch(429, {}, { "retry-after": "120" });
  const limited = await domain.refreshUsage("default");
  assert.equal(limited.status, "rate-limited");
  assert.equal(limited.windows.length, 2);

  await accounts.upsertAccount({
    id: ID_A,
    email: "a@example.com",
    orgId: "org-a",
    orgName: "Org A",
    subscriptionType: "pro",
    createdAt: "2026-09-02T00:00:00.000Z",
    lastLoginAt: "2026-09-02T00:00:00.000Z",
  });
  await accounts.materializeConfigDir(ID_A);
  const none = await domain.refreshUsage(ID_A);
  assert.equal(none.status, "unavailable");
  assert.deepEqual(none.windows, []);
  await call("DELETE", `/accounts/${ID_A}`);
});

void test("usage: a malformed registry makes the refresh route answer JSON 500, never an HTML stack", async () => {
  const registry = path.join(
    env.dispatchDir,
    "claude-accounts",
    "accounts.json",
  );
  fs.writeFileSync(registry, '{"accounts":[{"nope":1}]}');
  const res = await fetch(`${base}/accounts/${ID_A}/usage/refresh`, {
    method: "POST",
  });
  assert.equal(res.status, 500);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const text = await res.text();
  assert.equal(text, JSON.stringify({ error: "usage-refresh-failed" }));
  assert.doesNotMatch(text, /Users|node_modules|at /);
  fs.writeFileSync(registry, '{"version":1,"accounts":[]}');
});

void test("login: two starts in the same tick spawn exactly one child and one dir", async () => {
  const before = fs
    .readdirSync(path.join(env.dispatchDir, "claude-accounts"))
    .filter((n) => n !== "accounts.json").length;
  const [a, b] = await Promise.all([
    call("POST", "/accounts/login", {}),
    call("POST", "/accounts/login", {}),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [202, 409]);
  await waitForState("awaiting-code");
  const after = fs
    .readdirSync(path.join(env.dispatchDir, "claude-accounts"))
    .filter((n) => n !== "accounts.json").length;
  assert.equal(after, before + 1);
  const cancelled = await call("DELETE", "/accounts/login");
  assert.equal(cancelled.body.state, "idle");
  const final = fs
    .readdirSync(path.join(env.dispatchDir, "claude-accounts"))
    .filter((n) => n !== "accounts.json").length;
  assert.equal(final, before);
});

void test("login: a cancel that lands during startup leaves no child and no dir", async () => {
  const login = await import("../services/orchestration/claude-login.js");
  const before = fs
    .readdirSync(path.join(env.dispatchDir, "claude-accounts"))
    .filter((n) => n !== "accounts.json").length;
  const starting = login.startLogin();
  assert.equal(login.getLoginView().state, "starting");
  await login.cancelLogin();
  assert.equal(login.getLoginView().state, "idle");
  assert.deepEqual(await starting, { ok: true });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(login.getLoginView().state, "idle");
  const after = fs
    .readdirSync(path.join(env.dispatchDir, "claude-accounts"))
    .filter((n) => n !== "accounts.json").length;
  assert.equal(after, before);
});

void test("wiring: PUT /accounts/active refreshes the new account's usage through the 30 s limiter", async () => {
  const domain = await import("../services/orchestration/claude-usage.js");
  domain.forgetUsage("default");
  const calls = stubFetch(200, GRILL_PAYLOAD);
  const first = await call("PUT", "/accounts/active", { id: "default" });
  assert.equal(first.status, 200);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(calls(), 1);
  assert.equal(domain.getUsage("default").status, "ok");
  const second = await call("PUT", "/accounts/active", { id: "default" });
  assert.equal(second.status, 200);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(calls(), 1);
  domain.forgetUsage("default");
});

void test("usage: an added account reads its sha8-suffixed keychain item and never the home one", async () => {
  const domain = await import("../services/orchestration/claude-usage.js");
  await accounts.upsertAccount({
    id: ID_A,
    email: "a@example.com",
    orgId: "org-a",
    orgName: "Org A",
    subscriptionType: "pro",
    createdAt: "2026-09-02T00:00:00.000Z",
    lastLoginAt: "2026-09-02T00:00:00.000Z",
  });
  await accounts.materializeConfigDir(ID_A);
  const service = accounts.keychainServiceName(accounts.accountDir(ID_A));
  assert.match(service, /^Claude Code-credentials-[0-9a-f]{8}$/);
  fs.writeFileSync(
    path.join(env.keychainDir, service),
    '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-FAKE-ACCT-A"}}',
  );
  const calls = stubFetch(200, GRILL_PAYLOAD);
  const usage = await domain.refreshUsage(ID_A);
  assert.equal(usage.status, "ok");
  assert.equal(calls(), 1);
  assert.equal(lastAuthHeader, "Bearer sk-ant-oat01-FAKE-ACCT-A");
  await call("DELETE", `/accounts/${ID_A}`);
});

void test("usage: the poll loop refreshes at boot and again on every tick (DISPATCH_USAGE_POLL_MS)", async () => {
  const domain = await import("../services/orchestration/claude-usage.js");
  domain.forgetUsage("default");
  const calls = stubFetch(200, GRILL_PAYLOAD);
  process.env.DISPATCH_USAGE_POLL_MS = "60";
  const stop = domain.startUsagePollLoop();
  delete process.env.DISPATCH_USAGE_POLL_MS;
  await new Promise((r) => setTimeout(r, 250));
  stop();
  await new Promise((r) => setTimeout(r, 100));
  const seen = calls();
  assert.ok(seen >= 3, `expected boot + ticks, saw ${seen}`);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(calls(), seen);
  assert.equal(domain.getUsage("default").status, "ok");
  domain.forgetUsage("default");
});

void test("usage: a network failure keeps the last windows as error, a 500 is error/http-500", async () => {
  const domain = await import("../services/orchestration/claude-usage.js");
  domain.forgetUsage("default");
  stubFetch(200, GRILL_PAYLOAD);
  assert.equal((await domain.refreshUsage("default")).status, "ok");
  fetchRestores.push(() => {
    globalThis.fetch = realFetch;
  });
  globalThis.fetch = () => Promise.reject(new Error("offline"));
  const down = await domain.refreshUsage("default");
  assert.equal(down.status, "error");
  assert.equal(down.error, "unreachable");
  assert.equal(down.windows.length, 2);
  stubFetch(500, { error: "boom" });
  const broken = await domain.refreshUsage("default");
  assert.equal(broken.status, "error");
  assert.equal(broken.error, "http-500");
  assert.equal(broken.windows.length, 2);
  domain.forgetUsage("default");
});

void test("usage: a manual refresh inside a Retry-After window is refused without a network call", async () => {
  const domain = await import("../services/orchestration/claude-usage.js");
  domain.forgetUsage("default");
  const calls = stubFetch(429, {}, { "retry-after": "120" });
  const limited = await domain.refreshUsage("default");
  assert.equal(limited.status, "rate-limited");
  assert.equal(calls(), 1);
  const manual = await call("POST", "/accounts/default/usage/refresh");
  assert.equal(manual.status, 429);
  assert.equal(calls(), 1);
  domain.forgetUsage("default");
});
