import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import {
  cancelLogin,
  getAccounts,
  getLoginState,
  refreshAccountUsage,
  removeAccount,
  setActiveAccount,
  setChainOrder,
  setChainSettings,
  setSessionPin,
  startLogin,
  submitLoginCode,
  switchNow,
} from "./accounts-api.js";
import {
  ACCOUNTS_REFETCH_MS,
  LOGIN_POLL_MS,
  accountsKeys,
  accountsQueryOptions,
  cancelLoginMutationOptions,
  loginStateQueryOptions,
  refreshAccountUsageMutationOptions,
  removeAccountMutationOptions,
  setActiveAccountMutationOptions,
  setChainOrderMutationOptions,
  setChainSettingsMutationOptions,
  setSessionPinMutationOptions,
  startLoginMutationOptions,
  submitLoginCodeMutationOptions,
  switchNowMutationOptions,
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
  reply(200, { activeId: "a", accounts: [], sessions: [] });
  assert.deepEqual(await newClient().fetchQuery(options), {
    activeId: "a",
    accounts: [],
    sessions: [],
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

const ref = (n: number) => ({ cardId: `c${n}`, sessionId: `s${n}` });

test("setActiveAccount sends the apply choice and resolves the counts on a 200", async () => {
  reply(200, {
    activeId: "a",
    moved: [ref(1), ref(2)],
    queued: [ref(3)],
    skipped: [{ ...ref(4), reason: "legacy" }],
  });
  assert.deepEqual(await setActiveAccount("a", "all"), {
    ok: true,
    moved: 2,
    queued: 1,
    skipped: 1,
  });
  assert.equal(calls[0]?.url, "/api/accounts/active");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ id: "a", applyToRunning: "all" }),
  );
});

test("setActiveAccount reads a 404 as an unregistered account", async () => {
  reply(404, {});
  assert.deepEqual(await setActiveAccount("a", "idle"), {
    ok: false,
    error: "That account is no longer registered.",
  });
});

test("setActiveAccount reads any other status as a switch failure", async () => {
  reply(500, {});
  assert.deepEqual(await setActiveAccount("a", "none"), {
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

function isStale(client: QueryClient, key: readonly unknown[]): boolean {
  return client.getQueryState(key)?.isInvalidated === true;
}

function seededClient(): QueryClient {
  const client = newClient();
  client.setQueryData(accountsKeys.list, { activeId: "a", accounts: [] });
  client.setQueryData(accountsKeys.login, { state: "idle" });
  return client;
}

test("the accounts query refetches every minute and on every focus, never on mount", () => {
  const options = accountsQueryOptions();
  assert.equal(ACCOUNTS_REFETCH_MS, 60_000);
  assert.equal(options.refetchInterval, 60_000);
  assert.equal(options.refetchOnWindowFocus, "always");
  assert.equal(options.refetchOnMount, false);
  assert.equal(options.refetchIntervalInBackground, true);
});

test("the login state is dropped as soon as no dialog reads it", () => {
  assert.equal(loginStateQueryOptions().gcTime, 0);
});

test("the login state query polls every second until the login is done or failed", () => {
  const fn = loginStateQueryOptions().refetchInterval;
  assert.equal(LOGIN_POLL_MS, 1_000);
  assert.equal(typeof fn, "function");
  if (typeof fn !== "function") return;
  const interval = (data?: unknown) => fn({ state: { data } } as never);
  assert.equal(interval(), 1_000);
  assert.equal(interval({ state: "idle" }), 1_000);
  assert.equal(interval({ state: "starting", accountId: "a" }), 1_000);
  assert.equal(
    interval({ state: "awaiting-code", accountId: "a", url: "u" }),
    1_000,
  );
  assert.equal(interval({ state: "finishing", accountId: "a" }), 1_000);
  assert.equal(interval({ state: "done", account: { id: "a" } }), false);
  assert.equal(interval({ state: "error", message: "x" }), false);
});

test("an accepted account switch marks the list stale", async () => {
  const client = seededClient();
  reply(200, { activeId: "b", moved: [ref(1)], queued: [], skipped: [] });
  const result = await new MutationObserver(
    client,
    setActiveAccountMutationOptions(client),
  ).mutate({ id: "b", applyToRunning: "idle" });
  assert.deepEqual(result, { ok: true, moved: 1, queued: 0, skipped: 0 });
  assert.equal(calls[0]?.url, "/api/accounts/active");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ id: "b", applyToRunning: "idle" }),
  );
  assert.equal(isStale(client, accountsKeys.list), true);
});

test("a refused account switch resolves the message and still marks the list stale", async () => {
  const client = seededClient();
  reply(404, {}, "Not Found");
  const result = await new MutationObserver(
    client,
    setActiveAccountMutationOptions(client),
  ).mutate({ id: "b", applyToRunning: "none" });
  assert.deepEqual(result, {
    ok: false,
    error: "That account is no longer registered.",
  });
  assert.equal(isStale(client, accountsKeys.list), true);
});

test("an accepted usage refresh marks the list stale", async () => {
  const client = seededClient();
  reply(200, { usage: { state: "ok" } });
  const result = await new MutationObserver(
    client,
    refreshAccountUsageMutationOptions(client),
  ).mutate("b");
  assert.deepEqual(result, { ok: true, usage: { state: "ok" } });
  assert.equal(calls[0]?.url, "/api/accounts/b/usage/refresh");
  assert.equal(isStale(client, accountsKeys.list), true);
});

test("a rate-limited usage refresh resolves the wait notice and still marks the list stale", async () => {
  const client = seededClient();
  reply(429, {}, "Too Many Requests");
  const result = await new MutationObserver(
    client,
    refreshAccountUsageMutationOptions(client),
  ).mutate("b");
  assert.deepEqual(result, {
    ok: false,
    error: "Wait 30 seconds between refreshes.",
  });
  assert.equal(isStale(client, accountsKeys.list), true);
});

test("an accepted login start marks the login state stale", async () => {
  const client = seededClient();
  reply(200, { state: "starting", accountId: "n1" });
  const result = await new MutationObserver(
    client,
    startLoginMutationOptions(client),
  ).mutate(undefined);
  assert.deepEqual(result, { ok: true, accountId: "n1" });
  assert.equal(calls[0]?.url, "/api/accounts/login");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(isStale(client, accountsKeys.login), true);
  assert.equal(isStale(client, accountsKeys.list), false);
});

test("a refused login start resolves the in-flight flag and leaves the cache alone", async () => {
  const client = seededClient();
  reply(409, {}, "Conflict");
  const result = await new MutationObserver(
    client,
    startLoginMutationOptions(client),
  ).mutate(undefined);
  assert.deepEqual(result, {
    ok: false,
    error: "A Claude login is already in progress.",
    inFlight: true,
  });
  assert.equal(isStale(client, accountsKeys.login), false);
});

test("an accepted login code marks the login state stale", async () => {
  const client = seededClient();
  reply(200, {});
  const result = await new MutationObserver(
    client,
    submitLoginCodeMutationOptions(client),
  ).mutate("abc");
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0]?.url, "/api/accounts/login/code");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ code: "abc" }));
  assert.equal(isStale(client, accountsKeys.login), true);
});

test("a refused login code resolves the message and leaves the cache alone", async () => {
  const client = seededClient();
  reply(409, {}, "Conflict");
  const result = await new MutationObserver(
    client,
    submitLoginCodeMutationOptions(client),
  ).mutate("abc");
  assert.deepEqual(result, {
    ok: false,
    error: "No login is waiting for a code.",
  });
  assert.equal(isStale(client, accountsKeys.login), false);
});

test("a cancelled login marks the login state stale even when the request fails", async () => {
  const client = seededClient();
  reply(500, {}, "Internal Server Error");
  const result = await new MutationObserver(
    client,
    cancelLoginMutationOptions(client),
  ).mutate();
  assert.equal(result, undefined);
  assert.equal(calls[0]?.url, "/api/accounts/login");
  assert.equal(calls[0]?.init?.method, "DELETE");
  assert.equal(isStale(client, accountsKeys.login), true);
});

test("a removed account marks the list stale", async () => {
  const client = seededClient();
  reply(200, {});
  const result = await new MutationObserver(
    client,
    removeAccountMutationOptions(client),
  ).mutate("b");
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0]?.url, "/api/accounts/b");
  assert.equal(calls[0]?.init?.method, "DELETE");
  assert.equal(isStale(client, accountsKeys.list), true);
});

test("a refused account removal resolves the message and leaves the list alone", async () => {
  const client = seededClient();
  reply(400, {}, "Bad Request");
  const result = await new MutationObserver(
    client,
    removeAccountMutationOptions(client),
  ).mutate("default");
  assert.deepEqual(result, {
    ok: false,
    error: "The Default account cannot be removed.",
  });
  assert.equal(isStale(client, accountsKeys.list), false);
});

test("every login start still waiting for an answer counts under the start key", async () => {
  const pending: ((res: Response) => void)[] = [];
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => {
      pending.push(resolve);
    });
  const client = newClient();
  const first = new MutationObserver(client, startLoginMutationOptions(client));
  const second = new MutationObserver(
    client,
    startLoginMutationOptions(client),
  );
  const runs = [first.mutate(undefined), second.mutate(undefined)];
  await Promise.resolve();
  assert.equal(client.isMutating({ mutationKey: accountsKeys.start }), 2);
  for (const resolve of pending) {
    resolve(new Response(JSON.stringify({ state: "idle" }), { status: 202 }));
  }
  await Promise.all(runs);
  assert.equal(client.isMutating({ mutationKey: accountsKeys.start }), 0);
});

test("setChainOrder sends the full id list and resolves the saved order", async () => {
  reply(200, { order: ["b", "default", "a"] });
  assert.deepEqual(await setChainOrder(["b", "default", "a"]), {
    ok: true,
    order: ["b", "default", "a"],
  });
  assert.equal(calls[0]?.url, "/api/accounts/chain/order");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ order: ["b", "default", "a"] }),
  );
});

test("setChainOrder reads a 400 as a changed account list and anything else as a failure", async () => {
  reply(400, {});
  assert.deepEqual(await setChainOrder(["a"]), {
    ok: false,
    error: "The accounts changed. Reload and try the move again.",
  });
  reply(500, {});
  assert.deepEqual(await setChainOrder(["a"]), {
    ok: false,
    error: "Couldn't save the account order.",
  });
});

test("setChainSettings sends the patch and resolves the full settings", async () => {
  const settings = {
    autoMove: true,
    thresholdPercent: 90,
    minDwellMinutes: 15,
  };
  reply(200, settings);
  assert.deepEqual(await setChainSettings({ thresholdPercent: 90 }), {
    ok: true,
    settings,
  });
  assert.equal(calls[0]?.url, "/api/accounts/chain/settings");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ thresholdPercent: 90 }));
});

test("setChainSettings reads a 400 as out of range and anything else as a failure", async () => {
  reply(400, {});
  assert.deepEqual(await setChainSettings({ thresholdPercent: 5 }), {
    ok: false,
    error: "That value is out of range.",
  });
  reply(500, {});
  assert.deepEqual(await setChainSettings({ autoMove: true }), {
    ok: false,
    error: "Couldn't save the setting.",
  });
});

test("switchNow posts without a body and resolves the account it moved to", async () => {
  reply(200, { to: "b", result: {} });
  assert.deepEqual(await switchNow(), { ok: true, to: "b" });
  assert.equal(calls[0]?.url, "/api/accounts/chain/switch-now");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, undefined);
});

test("switchNow reads a 409 no-eligible-account as a readable message", async () => {
  reply(409, { error: "no-eligible-account" }, "Conflict");
  assert.deepEqual(await switchNow(), {
    ok: false,
    error: "No other account can take over right now.",
  });
});

test("switchNow reads any other refusal as a failure", async () => {
  reply(409, { error: "other" }, "Conflict");
  assert.deepEqual(await switchNow(), {
    ok: false,
    error: "Couldn't switch the account.",
  });
  reply(500, {});
  assert.deepEqual(await switchNow(), {
    ok: false,
    error: "Couldn't switch the account.",
  });
});

test("setSessionPin puts the session id and the flag on the card route", async () => {
  reply(200, { pinned: true });
  assert.deepEqual(await setSessionPin("c/1", "s1", true), {
    ok: true,
    pinned: true,
  });
  assert.equal(calls[0]?.url, "/api/cards/c%2F1/session/account-pin");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ sessionId: "s1", pinned: true }),
  );
});

test("setSessionPin reads a missing card or session as gone and anything else as a failure", async () => {
  reply(404, {});
  assert.deepEqual(await setSessionPin("c", "s", false), {
    ok: false,
    error: "That session is no longer running.",
  });
  reply(400, {});
  assert.deepEqual(await setSessionPin("c", "s", false), {
    ok: false,
    error: "That session is no longer running.",
  });
  reply(500, {});
  assert.deepEqual(await setSessionPin("c", "s", false), {
    ok: false,
    error: "Couldn't change the pin.",
  });
});

test("a chain order save marks the list stale, accepted or refused", async () => {
  for (const [status, ok] of [
    [200, true],
    [400, false],
  ] as const) {
    const client = seededClient();
    reply(status, status === 200 ? { order: ["a"] } : {});
    const result = await new MutationObserver(
      client,
      setChainOrderMutationOptions(client),
    ).mutate(["a"]);
    assert.equal(result.ok, ok);
    assert.equal(isStale(client, accountsKeys.list), true);
  }
});

test("an accepted settings save marks the list stale and a refused one leaves it", async () => {
  const accepted = seededClient();
  reply(200, { autoMove: true, thresholdPercent: 100, minDwellMinutes: 15 });
  await new MutationObserver(
    accepted,
    setChainSettingsMutationOptions(accepted),
  ).mutate({ autoMove: true });
  assert.equal(isStale(accepted, accountsKeys.list), true);

  const refused = seededClient();
  reply(400, {});
  await new MutationObserver(
    refused,
    setChainSettingsMutationOptions(refused),
  ).mutate({ thresholdPercent: 5 });
  assert.equal(isStale(refused, accountsKeys.list), false);
});

test("switch now and a pin change mark the list stale", async () => {
  const moved = seededClient();
  reply(200, { to: "b", result: {} });
  await new MutationObserver(moved, switchNowMutationOptions(moved)).mutate();
  assert.equal(isStale(moved, accountsKeys.list), true);

  const refused = seededClient();
  reply(409, { error: "no-eligible-account" }, "Conflict");
  const result = await new MutationObserver(
    refused,
    switchNowMutationOptions(refused),
  ).mutate();
  assert.equal(result.ok, false);
  assert.equal(isStale(refused, accountsKeys.list), true);

  const pinned = seededClient();
  reply(200, { pinned: true });
  await new MutationObserver(
    pinned,
    setSessionPinMutationOptions(pinned),
  ).mutate({ cardId: "c", sessionId: "s", pinned: true });
  assert.equal(isStale(pinned, accountsKeys.list), true);
});
