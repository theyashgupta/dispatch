import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { RateLimited } from "../ticket.source.js";
import {
  fetchGithubLogin,
  GitHubAuthError,
  GitHubSource,
  GitHubSsoError,
} from "./github.source.js";

const TOKEN = "g5-fake-gh-token";

interface Seen {
  url: string;
  headers: Record<string, string>;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function stubFetch(answer: (url: URL) => Response | Promise<Response>): Seen[] {
  const seen: Seen[] = [];
  mock.method(globalThis, "fetch", (input: string, init?: RequestInit) => {
    const url = new URL(input);
    seen.push({ url: input, headers: init?.headers as Record<string, string> });
    return Promise.resolve(answer(url));
  });
  return seen;
}

function source(token: string | null = TOKEN): GitHubSource {
  return new GitHubSource(
    () => Promise.resolve(token === null ? null : { token, via: "gh" }),
    60_000,
  );
}

function searchBody(numbers: number[], total = numbers.length) {
  return {
    total_count: total,
    incomplete_results: false,
    items: numbers.map((n) => ({
      number: n,
      title: `PR ${n}`,
      body: "",
      html_url: `https://github.com/acme/api/pull/${n}`,
      repository_url: "https://api.github.com/repos/acme/api",
      user: { login: "octo" },
      updated_at: "2026-09-25T09:00:00Z",
    })),
  };
}

afterEach(() => mock.restoreAll());

test("fetch runs the three is:pr queries in order with the GitHub headers", async () => {
  const seen = stubFetch((url) => {
    const q = url.searchParams.get("q") ?? "";
    if (q.includes("review-requested"))
      return jsonResponse(200, searchBody([12]));
    if (q.includes("mentions")) return jsonResponse(200, searchBody([12, 15]));
    return jsonResponse(200, searchBody([]));
  });
  const result = await source().fetch();
  assert.deepEqual(
    seen.map((s) => new URL(s.url).searchParams.get("q")),
    [
      "is:open is:pr review-requested:@me",
      "is:open is:pr mentions:@me",
      "is:open is:pr assignee:@me",
    ],
  );
  assert.ok(
    seen.every((s) => new URL(s.url).searchParams.get("per_page") === "100"),
  );
  assert.ok(
    seen.every((s) => s.url.startsWith("https://api.github.com/search/issues")),
  );
  assert.deepEqual(seen[0]?.headers, {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "dispatch",
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.truncated, false);
  assert.deepEqual(
    result.items.map((i) => [i.id, i.type]),
    [
      ["github:acme/api#12", "pr_review"],
      ["github:acme/api#15", "pr_mention"],
    ],
  );
});

test("a category over 100 results makes the pull truncated", async () => {
  stubFetch(() => jsonResponse(200, searchBody([1], 150)));
  assert.equal((await source().fetch()).truncated, true);
});

test("an SSO partial-results header makes the pull truncated", async () => {
  stubFetch(() =>
    jsonResponse(200, searchBody([1]), {
      "x-github-sso": "partial-results; organizations=21955855",
    }),
  );
  assert.equal((await source().fetch()).truncated, true);
});

test("no credential fails the poll before any request", async () => {
  const seen = stubFetch(() => jsonResponse(200, searchBody([])));
  await assert.rejects(source(null).fetch(), /no GitHub credential/);
  assert.equal(seen.length, 0);
});

test("a 401 fails the poll with the auth error", async () => {
  stubFetch(() => jsonResponse(401, { message: "Bad credentials" }));
  await assert.rejects(source().fetch(), GitHubAuthError);
});

test("an exhausted rate limit raises the rate-limit sentinel", async () => {
  stubFetch(() =>
    jsonResponse(
      403,
      { message: "rate limit" },
      { "x-ratelimit-remaining": "0" },
    ),
  );
  await assert.rejects(source().fetch(), RateLimited);
  mock.restoreAll();
  stubFetch(() => jsonResponse(429, { message: "slow down" }));
  await assert.rejects(source().fetch(), RateLimited);
});

test("a 403 with SSO required raises the SSO error with its URL", async () => {
  stubFetch(() =>
    jsonResponse(
      403,
      { message: "SAML" },
      {
        "x-github-sso":
          "required; url=https://github.com/orgs/acme/sso?authorization_request=x",
      },
    ),
  );
  await assert.rejects(source().fetch(), (err: unknown) => {
    assert.ok(err instanceof GitHubSsoError);
    assert.equal(
      err.ssoUrl,
      "https://github.com/orgs/acme/sso?authorization_request=x",
    );
    return true;
  });
});

test("a network failure propagates as the fetch TypeError", async () => {
  mock.method(globalThis, "fetch", () =>
    Promise.reject(
      Object.assign(new TypeError("fetch failed"), {
        cause: new Error("ECONNREFUSED"),
      }),
    ),
  );
  await assert.rejects(source().fetch(), TypeError);
});

test("no error message carries the token", async () => {
  stubFetch(() => jsonResponse(500, { message: TOKEN }));
  await assert.rejects(source().fetch(), (err: unknown) => {
    assert.ok(!String((err as Error).message).includes(TOKEN));
    return true;
  });
});

test("fetchGithubLogin answers the login, null for a rejected token, and throws on an outage", async () => {
  stubFetch(() => jsonResponse(200, { login: "g5-tester" }));
  assert.deepEqual(await fetchGithubLogin(TOKEN), { account: "g5-tester" });
  mock.restoreAll();
  stubFetch(() => jsonResponse(401, {}));
  assert.equal(await fetchGithubLogin(TOKEN), null);
  mock.restoreAll();
  stubFetch(() => jsonResponse(502, {}));
  await assert.rejects(fetchGithubLogin(TOKEN));
});
