import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { getSentryIssue, resolveSentryIssue } from "./errors-api.js";
import { errorsKeys, sentryIssueQueryOptions } from "./errors-queries.js";

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

test("sentryIssueQueryOptions always refetches and never serves a stale failure", () => {
  assert.equal(sentryIssueQueryOptions("i1").staleTime, 0);
});

test("errorsKeys has the documented shape", () => {
  assert.deepEqual(errorsKeys.all, ["errors"]);
  assert.deepEqual(errorsKeys.issue("i1"), ["errors", "issue", "i1"]);
});

test("sentryIssueQueryOptions keys on the issue and requests its detail", async () => {
  const options = sentryIssueQueryOptions("i 1");
  assert.deepEqual(options.queryKey, ["errors", "issue", "i 1"]);
  reply(200, { title: "Boom" });
  assert.deepEqual(await newClient().fetchQuery(options), {
    ok: true,
    detail: { title: "Boom" },
  });
  assert.equal(calls[0]?.url, "/api/sentry/issue/i%201");
});

test("getSentryIssue carries the failure body", async () => {
  reply(403, { error: "sso-required", message: "m", ssoUrl: "https://sso" });
  assert.deepEqual(await getSentryIssue("i1"), {
    ok: false,
    error: "sso-required",
    message: "m",
    ssoUrl: "https://sso",
  });
});

test("getSentryIssue returns the unreachable failure shape when the network fails", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("network down"));
  assert.deepEqual(await getSentryIssue("i1"), {
    ok: false,
    error: "unreachable",
  });
});

test("resolveSentryIssue resolves ok on a 200", async () => {
  reply(200, {});
  assert.deepEqual(await resolveSentryIssue("i 1"), { ok: true });
  assert.equal(calls[0]?.url, "/api/sentry/issue/i%201/resolve");
  assert.equal(calls[0]?.init?.method, "POST");
});

test("resolveSentryIssue reads a failure with no error code as unreachable", async () => {
  reply(500, "");
  assert.deepEqual(await resolveSentryIssue("i1"), {
    ok: false,
    error: "unreachable",
  });
});
