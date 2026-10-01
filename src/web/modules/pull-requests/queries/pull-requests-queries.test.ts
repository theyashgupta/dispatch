import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  getPullRequest,
  mergePullRequest,
  reviewPullRequest,
} from "./pull-requests-api.js";
import {
  pullRequestQueryOptions,
  pullRequestsKeys,
} from "./pull-requests-queries.js";

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

function reject(): void {
  globalThis.fetch = () => Promise.reject(new TypeError("network down"));
}

test("pullRequestQueryOptions always refetches and never serves a stale success", () => {
  assert.equal(pullRequestQueryOptions("o", "r", 7).staleTime, 0);
});

test("pullRequestsKeys has the documented shape", () => {
  assert.deepEqual(pullRequestsKeys.all, ["pull-requests"]);
  assert.deepEqual(pullRequestsKeys.detail("o", "r", 7), [
    "pull-requests",
    "o",
    "r",
    7,
  ]);
});

test("pullRequestQueryOptions keys on the pull request and requests its detail", async () => {
  const options = pullRequestQueryOptions("o w", "r", 7);
  assert.deepEqual(options.queryKey, ["pull-requests", "o w", "r", 7]);
  reply(200, { title: "T" });
  assert.deepEqual(await newClient().fetchQuery(options), {
    ok: true,
    detail: { title: "T" },
  });
  assert.equal(calls[0]?.url, "/api/github/pr/o%20w/r/7");
});

test("getPullRequest resolves the detail on a 200", async () => {
  reply(200, { title: "T" });
  assert.deepEqual(await getPullRequest("o", "r", 7), {
    ok: true,
    detail: { title: "T" },
  });
});

test("getPullRequest carries the error, message and sso url of a failure body", async () => {
  reply(403, { error: "sso-required", message: "m", ssoUrl: "https://sso" });
  assert.deepEqual(await getPullRequest("o", "r", 7), {
    ok: false,
    error: "sso-required",
    message: "m",
    ssoUrl: "https://sso",
  });
});

test("getPullRequest drops a message and sso url that are not strings", async () => {
  reply(403, { error: "x", message: 1, ssoUrl: null });
  assert.deepEqual(await getPullRequest("o", "r", 7), {
    ok: false,
    error: "x",
  });
});

test("getPullRequest reads a failure with no error code as unreachable", async () => {
  reply(500, "<html>");
  assert.deepEqual(await getPullRequest("o", "r", 7), {
    ok: false,
    error: "unreachable",
  });
});

test("getPullRequest returns the unreachable failure shape when the network fails", async () => {
  reject();
  assert.deepEqual(await getPullRequest("o", "r", 7), {
    ok: false,
    error: "unreachable",
  });
});

test("reviewPullRequest resolves ok on a 200 and sends the event and body", async () => {
  reply(200, {});
  assert.deepEqual(await reviewPullRequest("o", "r", 7, "APPROVE", "lgtm"), {
    ok: true,
  });
  assert.equal(calls[0]?.url, "/api/github/pr/o/r/7/review");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ event: "APPROVE", body: "lgtm" }),
  );
});

test("reviewPullRequest omits an empty body", async () => {
  reply(200, {});
  await reviewPullRequest("o", "r", 7, "APPROVE");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ event: "APPROVE" }));
});

test("reviewPullRequest carries the failure body", async () => {
  reply(422, { error: "conflict", message: "stale" });
  assert.deepEqual(await reviewPullRequest("o", "r", 7, "APPROVE"), {
    ok: false,
    error: "conflict",
    message: "stale",
  });
});

test("reviewPullRequest returns the unreachable failure shape when the network fails", async () => {
  reject();
  assert.deepEqual(await reviewPullRequest("o", "r", 7, "APPROVE"), {
    ok: false,
    error: "unreachable",
  });
});

test("mergePullRequest resolves ok on a 200 and sends the sha", async () => {
  reply(200, {});
  assert.deepEqual(await mergePullRequest("o", "r", 7, "abc"), { ok: true });
  assert.equal(calls[0]?.url, "/api/github/pr/o/r/7/merge");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ sha: "abc" }));
});

test("mergePullRequest carries the failure body", async () => {
  reply(409, { error: "head-moved" });
  assert.deepEqual(await mergePullRequest("o", "r", 7, "abc"), {
    ok: false,
    error: "head-moved",
  });
});

test("mergePullRequest returns the unreachable failure shape when the network fails", async () => {
  reject();
  assert.deepEqual(await mergePullRequest("o", "r", 7, "abc"), {
    ok: false,
    error: "unreachable",
  });
});
