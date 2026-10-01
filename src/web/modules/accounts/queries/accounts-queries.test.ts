import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  cancelLogin,
  getAccounts,
  getLoginState,
  refreshAccountUsage,
  removeAccount,
  setActiveAccount,
  startLogin,
  submitLoginCode,
} from "./accounts-api.js";
import {
  accountsKeys,
  accountsQueryOptions,
  loginStateQueryOptions,
} from "./accounts-queries.js";

const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];

function reply(status: number, body: unknown, statusText = ""): void {
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url:
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      init,
    });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return Promise.resolve(
      new Response(status === 204 ? null : text, { status, statusText }),
    );
  };
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

test("accountsKeys has the documented shape", () => {
  assert.deepEqual(accountsKeys.all, ["accounts"]);
  assert.deepEqual(accountsKeys.list, ["accounts", "list"]);
  assert.deepEqual(accountsKeys.login, ["accounts", "login"]);
});

test("accountsQueryOptions requests the account list", async () => {
  const options = accountsQueryOptions();
  assert.deepEqual(options.queryKey, ["accounts", "list"]);
  reply(200, { activeId: "a", accounts: [] });
  assert.deepEqual(await newClient().fetchQuery(options), {
    activeId: "a",
    accounts: [],
  });
  assert.equal(calls[0]?.url, "/api/accounts");
});

test("loginStateQueryOptions requests the login state", async () => {
  const options = loginStateQueryOptions();
  assert.deepEqual(options.queryKey, ["accounts", "login"]);
  reply(200, { state: "idle" });
  assert.deepEqual(await newClient().fetchQuery(options), { state: "idle" });
  assert.equal(calls[0]?.url, "/api/accounts/login");
});

test("getAccounts throws on a failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    getAccounts(),
    new Error("getAccounts failed: 500 Internal Server Error"),
  );
});

test("getLoginState throws on a failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    getLoginState(),
    new Error("getLoginState failed: 500 Internal Server Error"),
  );
});

test("setActiveAccount resolves ok on a 200", async () => {
  reply(200, {});
  assert.deepEqual(await setActiveAccount("a"), { ok: true });
  assert.equal(calls[0]?.url, "/api/accounts/active");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ id: "a" }));
});

test("setActiveAccount reads a 404 as an unregistered account", async () => {
  reply(404, {});
  assert.deepEqual(await setActiveAccount("a"), {
    ok: false,
    error: "That account is no longer registered.",
  });
});

test("setActiveAccount reads any other status as a switch failure", async () => {
  reply(500, {});
  assert.deepEqual(await setActiveAccount("a"), {
    ok: false,
    error: "Couldn't switch the Claude account.",
  });
});

test("refreshAccountUsage resolves the usage on a 200", async () => {
  reply(200, { usage: { fiveHour: 1 } });
  assert.deepEqual(await refreshAccountUsage("a b"), {
    ok: true,
    usage: { fiveHour: 1 },
  });
  assert.equal(calls[0]?.url, "/api/accounts/a%20b/usage/refresh");
  assert.equal(calls[0]?.init?.method, "POST");
});

test("refreshAccountUsage reads a 429 as the wait notice", async () => {
  reply(429, {});
  assert.deepEqual(await refreshAccountUsage("a"), {
    ok: false,
    error: "Wait 30 seconds between refreshes.",
  });
});

test("refreshAccountUsage reads any other status as a refresh failure", async () => {
  reply(500, {});
  assert.deepEqual(await refreshAccountUsage("a"), {
    ok: false,
    error: "Couldn't refresh usage.",
  });
});

test("startLogin resolves the account id of the returned view on a 200", async () => {
  reply(200, { state: "waiting", accountId: "new-1" });
  assert.deepEqual(await startLogin(), { ok: true, accountId: "new-1" });
  assert.equal(calls[0]?.url, "/api/accounts/login");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, "{}");
});

test("startLogin falls back to the requested account when the view has none", async () => {
  reply(200, { state: "waiting" });
  assert.deepEqual(await startLogin("acc-2"), { ok: true, accountId: "acc-2" });
  assert.equal(calls[0]?.init?.body, JSON.stringify({ accountId: "acc-2" }));
});

test("startLogin resolves a null account id when the body is empty and none was requested", async () => {
  reply(200, "");
  assert.deepEqual(await startLogin(), { ok: true, accountId: null });
});

test("startLogin reads a 200 with a garbled body as a failed start", async () => {
  reply(200, "not json");
  assert.deepEqual(await startLogin(), {
    ok: false,
    error: "Couldn't start the Claude login.",
  });
});

test("startLogin reads a 409 as a login already in progress", async () => {
  reply(409, {});
  assert.deepEqual(await startLogin(), {
    ok: false,
    error: "A Claude login is already in progress.",
    inFlight: true,
  });
});

test("startLogin reads a 404 as an unregistered account", async () => {
  reply(404, {});
  assert.deepEqual(await startLogin("x"), {
    ok: false,
    error: "That account is no longer registered.",
  });
});

test("startLogin reads any other status as a start failure", async () => {
  reply(500, {});
  assert.deepEqual(await startLogin(), {
    ok: false,
    error: "Couldn't start the Claude login.",
  });
});

test("submitLoginCode resolves ok on a 200", async () => {
  reply(200, {});
  assert.deepEqual(await submitLoginCode("abc"), { ok: true });
  assert.equal(calls[0]?.url, "/api/accounts/login/code");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ code: "abc" }));
});

test("submitLoginCode reads a 409 as no login waiting", async () => {
  reply(409, {});
  assert.deepEqual(await submitLoginCode("abc"), {
    ok: false,
    error: "No login is waiting for a code.",
  });
});

test("submitLoginCode reads a 400 as a multi-line code", async () => {
  reply(400, {});
  assert.deepEqual(await submitLoginCode("abc"), {
    ok: false,
    error: "Paste the whole code on one line.",
  });
});

test("submitLoginCode reads any other status as a submit failure", async () => {
  reply(500, {});
  assert.deepEqual(await submitLoginCode("abc"), {
    ok: false,
    error: "Couldn't submit the code.",
  });
});

test("cancelLogin sends a DELETE and resolves nothing", async () => {
  reply(204, null);
  assert.equal(await cancelLogin(), undefined);
  assert.equal(calls[0]?.url, "/api/accounts/login");
  assert.equal(calls[0]?.init?.method, "DELETE");
});

test("cancelLogin swallows a network failure", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("network down"));
  assert.equal(await cancelLogin(), undefined);
});

test("removeAccount resolves ok on a 200", async () => {
  reply(200, {});
  assert.deepEqual(await removeAccount("a/b"), { ok: true });
  assert.equal(calls[0]?.url, "/api/accounts/a%2Fb");
  assert.equal(calls[0]?.init?.method, "DELETE");
});

test("removeAccount reads a 404 as an unregistered account", async () => {
  reply(404, {});
  assert.deepEqual(await removeAccount("a"), {
    ok: false,
    error: "That account is no longer registered.",
  });
});

test("removeAccount reads a 400 as the protected Default account", async () => {
  reply(400, {});
  assert.deepEqual(await removeAccount("default"), {
    ok: false,
    error: "The Default account cannot be removed.",
  });
});

test("removeAccount reads any other status as a remove failure", async () => {
  reply(500, {});
  assert.deepEqual(await removeAccount("a"), {
    ok: false,
    error: "Couldn't remove the account.",
  });
});
