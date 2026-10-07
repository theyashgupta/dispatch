import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { getAccounts } from "./accounts-api.js";
import {
  ACCOUNTS_REFETCH_MS,
  accountsKeys,
  accountsQueryOptions,
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
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, statusText }),
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

test("getAccounts throws on a failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    getAccounts(),
    new Error("getAccounts failed: 500 Internal Server Error"),
  );
});

test("the accounts query refetches every minute and on every focus, never on mount", () => {
  const options = accountsQueryOptions();
  assert.equal(ACCOUNTS_REFETCH_MS, 60_000);
  assert.equal(options.refetchInterval, 60_000);
  assert.equal(options.refetchOnWindowFocus, "always");
  assert.equal(options.refetchOnMount, false);
  assert.equal(options.refetchIntervalInBackground, true);
});
