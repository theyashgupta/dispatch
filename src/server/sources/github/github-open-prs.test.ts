import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { GitHubSource } from "./github.source.js";
import {
  mapOpenPrs,
  openPrsRequest,
  type OpenPrsAnswer,
} from "./github-open-prs.js";

const TOKEN = "g5-fake-gh-token";

function node(number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    title: `PR ${number}`,
    body: "  body text  ",
    url: `https://github.com/acme/api/pull/${number}`,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-25T09:00:00Z",
    isDraft: false,
    reviewDecision: null,
    headRefName: `feat/${number}`,
    baseRefName: "main",
    changedFiles: 3,
    author: { login: "octo" },
    repository: { nameWithOwner: "acme/api" },
    reviewRequests: { nodes: [] },
    commits: { nodes: [] },
    ...overrides,
  };
}

function answer(nodes: unknown[], issueCount = nodes.length): OpenPrsAnswer {
  return { data: { search: { issueCount, nodes } } } as OpenPrsAnswer;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => mock.restoreAll());

test("the request has one repo term per repository and the open PR terms", () => {
  const { variables } = openPrsRequest(["acme/api", "acme/web"]);
  assert.equal(
    variables.q,
    "is:open is:pr repo:acme/api repo:acme/web sort:updated-desc",
  );
  assert.equal(variables.first, 100);
});

test("mapOpenPrs maps every state field", () => {
  const { items, truncated } = mapOpenPrs(
    answer([
      node(7, {
        isDraft: true,
        reviewDecision: "CHANGES_REQUESTED",
        reviewRequests: {
          nodes: [
            { requestedReviewer: { login: "someone" } },
            { requestedReviewer: {} },
            { requestedReviewer: { login: "me" } },
          ],
        },
        commits: {
          nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }],
        },
      }),
    ]),
    "me",
  );
  assert.equal(truncated, false);
  assert.deepEqual(items, [
    {
      id: "github:acme/api#7",
      source: "github",
      type: "pr_open",
      title: "PR 7",
      snippet: "body text",
      url: "https://github.com/acme/api/pull/7",
      createdAt: "2026-09-25T09:00:00Z",
      priority: 25,
      state: "unread",
      meta: {
        repo: "acme/api",
        number: "7",
        author: "octo",
        draft: "true",
        reviewDecision: "CHANGES_REQUESTED",
        reviewRequestedFromMe: "true",
        checks: "pass",
        createdAt: "2026-09-01T00:00:00Z",
        headRef: "feat/7",
        baseRef: "main",
        changedFiles: "3",
        category: "open",
      },
    },
  ]);
});

test("reviewRequestedFromMe is false when another user is requested", () => {
  const { items } = mapOpenPrs(
    answer([
      node(1, {
        reviewRequests: { nodes: [{ requestedReviewer: { login: "other" } }] },
      }),
    ]),
    "me",
  );
  assert.equal(items[0]?.meta.reviewRequestedFromMe, "false");
  assert.equal(items[0]?.meta.reviewDecision, "");
});

test("the rollup state maps to pass, fail, pending or empty", () => {
  const checks = (state?: string) =>
    mapOpenPrs(
      answer([
        node(1, {
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: state === undefined ? null : { state },
                },
              },
            ],
          },
        }),
      ]),
      "me",
    ).items[0]?.meta.checks;
  assert.equal(checks("SUCCESS"), "pass");
  assert.equal(checks("FAILURE"), "fail");
  assert.equal(checks("ERROR"), "fail");
  assert.equal(checks("PENDING"), "pending");
  assert.equal(checks("EXPECTED"), "pending");
  assert.equal(checks(), "");
});

test("an errors array with data maps the nodes, sets truncated and logs the messages only", () => {
  const warn = mock.method(console, "warn", () => {});
  const out = mapOpenPrs(
    { ...answer([node(1)]), errors: [{ message: "Could not resolve repo" }] },
    "me",
  );
  assert.equal(out.truncated, true);
  assert.deepEqual(
    out.items.map((i) => i.id),
    ["github:acme/api#1"],
  );
  assert.equal(warn.mock.callCount(), 1);
  const line = String(warn.mock.calls[0]?.arguments[0]);
  assert.ok(line.includes("Could not resolve repo"));
  assert.ok(!line.includes("body text"));
});

test("an errors array without data maps no item and sets truncated", () => {
  mock.method(console, "warn", () => {});
  const out = mapOpenPrs({ errors: [{ message: "boom" }] }, "me");
  assert.deepEqual(out, { items: [], truncated: true });
});

test("an issueCount above 100 sets truncated and keeps the items", () => {
  const out = mapOpenPrs(answer([node(1)], 101), "me");
  assert.equal(out.truncated, true);
  assert.equal(out.items.length, 1);
  assert.equal(mapOpenPrs(answer([node(1)], 100), "me").truncated, false);
});

test("fetch posts one GraphQL search per poll and flags truncation", async () => {
  const calls: { url: string; body: unknown }[] = [];
  mock.method(globalThis, "fetch", (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/graphql") {
      calls.push({ url: input, body: JSON.parse(init?.body as string) });
      return Promise.resolve(jsonResponse(answer([node(4)], 150)));
    }
    if (url.pathname === "/user") {
      return Promise.resolve(jsonResponse({ login: "me" }));
    }
    return Promise.resolve(
      jsonResponse({ total_count: 0, incomplete_results: false, items: [] }),
    );
  });
  const source = new GitHubSource(
    () => Promise.resolve({ token: TOKEN, via: "gh" }),
    60_000,
    () => Promise.resolve(["acme/api"]),
  );
  const result = await source.fetch();
  assert.equal(calls.length, 1);
  assert.ok(calls[0]?.url.endsWith("/graphql"));
  assert.equal(result.truncated, true);
  assert.deepEqual(
    result.items.map((i) => [i.id, i.type]),
    [["github:acme/api#4", "pr_open"]],
  );
});

test("no repository makes no GraphQL and no login call", async () => {
  const urls: string[] = [];
  mock.method(globalThis, "fetch", (input: string) => {
    urls.push(new URL(input).pathname);
    return Promise.resolve(
      jsonResponse({ total_count: 0, incomplete_results: false, items: [] }),
    );
  });
  const source = new GitHubSource(
    () => Promise.resolve({ token: TOKEN, via: "gh" }),
    60_000,
    () => Promise.resolve([]),
  );
  await source.fetch();
  assert.deepEqual(urls, [
    "/search/issues",
    "/search/issues",
    "/search/issues",
  ]);
});

test("a GraphQL failure keeps the @me results and marks the pull incomplete", async () => {
  const warn = mock.method(console, "warn", () => {});
  mock.method(globalThis, "fetch", (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/graphql") {
      return Promise.resolve(new Response("bad gateway", { status: 502 }));
    }
    if (url.pathname === "/user") {
      return Promise.resolve(jsonResponse({ login: "me" }));
    }
    return Promise.resolve(
      jsonResponse({
        total_count: 1,
        incomplete_results: false,
        items: [
          {
            number: 12,
            title: "PR 12",
            body: "",
            html_url: "https://github.com/acme/api/pull/12",
            repository_url: "https://api.github.com/repos/acme/api",
            user: { login: "octo" },
            updated_at: "2026-09-25T09:00:00Z",
          },
        ],
      }),
    );
  });
  const source = new GitHubSource(
    () => Promise.resolve({ token: TOKEN, via: "gh" }),
    60_000,
    () => Promise.resolve(["acme/api"]),
  );
  const result = await source.fetch();
  assert.equal(result.truncated, true);
  assert.ok(result.items.some((i) => i.id === "github:acme/api#12"));
  assert.equal(warn.mock.callCount(), 1);
  assert.ok(!String(warn.mock.calls[0]?.arguments[0]).includes(TOKEN));
});

test("a GraphQL auth or rate limit error propagates instead of degrading", async () => {
  mock.method(console, "warn", () => {});
  for (const res of [
    () => new Response("no", { status: 401 }),
    () => new Response("slow", { status: 429 }),
  ]) {
    mock.method(globalThis, "fetch", (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/graphql") return Promise.resolve(res());
      if (url.pathname === "/user") {
        return Promise.resolve(jsonResponse({ login: "me" }));
      }
      return Promise.resolve(
        jsonResponse({ total_count: 0, incomplete_results: false, items: [] }),
      );
    });
    const source = new GitHubSource(
      () => Promise.resolve({ token: TOKEN, via: "gh" }),
      60_000,
      () => Promise.resolve(["acme/api"]),
    );
    await assert.rejects(() => source.fetch());
    mock.restoreAll();
    mock.method(console, "warn", () => {});
  }
});
