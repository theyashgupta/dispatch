import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { RateLimited } from "../ticket.source.js";
import {
  allowedRegion,
  SentryAuthError,
  sentryItem,
  SentryRequestError,
  sentryPriority,
  SentrySource,
} from "./sentry.source.js";

const TOKEN = ["g5", "fake", "sentry", "token"].join("-");

interface Org {
  slug: string;
  regionUrl?: string;
  forbidden?: boolean;
}

interface Issue {
  id: string;
  org: string;
  level?: string;
  assigned?: boolean;
  count?: string | number;
}

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

function raw(issue: Issue) {
  return {
    id: issue.id,
    title: `Issue ${issue.id}`,
    culprit: `culprit ${issue.id}`,
    permalink: `https://${issue.org}.sentry.io/issues/${issue.id}/`,
    shortId: `API-${issue.id}`,
    level: issue.level ?? "error",
    count: issue.count ?? "7",
    userCount: 3,
    lastSeen: "2026-09-25T09:00:00Z",
    project: { slug: "api" },
  };
}

function stub(
  orgs: Org[],
  issues: Issue[],
  opts: {
    status?: number;
    headers?: Record<string, string>;
    link?: string;
  } = {},
): URL[] {
  const seen: URL[] = [];
  mock.method(globalThis, "fetch", (input: string, init?: RequestInit) => {
    const url = new URL(input);
    seen.push(url);
    const auth = new Headers(init?.headers).get("authorization");
    assert.equal(auth, `Bearer ${TOKEN}`);
    if (opts.status) {
      return Promise.resolve(json(opts.status, {}, opts.headers));
    }
    if (url.pathname === "/api/0/organizations/") {
      return Promise.resolve(
        json(
          200,
          orgs.map((o) => ({
            slug: o.slug,
            links: { regionUrl: o.regionUrl ?? "" },
          })),
        ),
      );
    }
    const m = /^\/api\/0\/organizations\/([^/]+)\/issues\/$/.exec(url.pathname);
    const org = orgs.find((o) => o.slug === m?.[1]);
    if (!org) return Promise.resolve(json(404, {}));
    if (org.forbidden) return Promise.resolve(json(403, {}));
    const assignedOnly = (url.searchParams.get("query") ?? "").includes(
      "assigned:me",
    );
    const rows = issues
      .filter((i) => i.org === org.slug && (!assignedOnly || i.assigned))
      .map(raw);
    return Promise.resolve(
      json(200, rows, opts.link ? { link: opts.link } : {}),
    );
  });
  return seen;
}

function source(): SentrySource {
  return new SentrySource(
    () => Promise.resolve({ token: TOKEN, via: "vault" }),
    60_000,
  );
}

afterEach(() => mock.restoreAll());

test("each org runs the assigned query then the unresolved query with the 14 day period and limit", async () => {
  const seen = stub([{ slug: "acme" }], [{ id: "1", org: "acme" }]);
  await source().fetch();
  const queries = seen
    .filter((u) => u.pathname.endsWith("/issues/"))
    .map((u) => [
      u.pathname,
      u.searchParams.get("query"),
      u.searchParams.get("statsPeriod"),
      u.searchParams.get("limit"),
    ]);
  assert.deepEqual(queries, [
    [
      "/api/0/organizations/acme/issues/",
      "is:unresolved assigned:me",
      "14d",
      "100",
    ],
    ["/api/0/organizations/acme/issues/", "is:unresolved", "14d", "100"],
  ]);
  assert.equal(seen[0]?.origin, "https://sentry.io");
});

test("an issue in both queries stays assigned and appears once", async () => {
  stub(
    [{ slug: "acme" }],
    [
      { id: "1", org: "acme", assigned: true },
      { id: "2", org: "acme" },
    ],
  );
  const { items, truncated } = await source().fetch();
  assert.deepEqual(
    items.map((i) => [i.id, i.type, i.meta.category]),
    [
      ["sentry:1", "error_assigned", "assigned"],
      ["sentry:2", "error", "unresolved"],
    ],
  );
  assert.equal(truncated, false);
});

test("every assigned issue ranks above every org-wide issue", () => {
  assert.equal(sentryPriority("fatal", "assigned"), 100);
  assert.equal(sentryPriority("error", "assigned"), 100);
  assert.equal(sentryPriority("warning", "assigned"), 75);
  assert.equal(sentryPriority("info", "assigned"), 75);
  assert.equal(sentryPriority("fatal", "unresolved"), 50);
  assert.equal(sentryPriority("error", "unresolved"), 50);
  assert.equal(sentryPriority("warning", "unresolved"), 25);
  assert.equal(sentryPriority(null, "unresolved"), 25);
  assert.ok(
    sentryPriority("info", "assigned") > sentryPriority("fatal", "unresolved"),
  );
});

test("an item carries the U2-04 fields with the count as a decimal string", async () => {
  stub(
    [{ slug: "acme" }],
    [{ id: "9", org: "acme", assigned: true, level: "fatal", count: 1234 }],
  );
  const [item] = (await source().fetch()).items;
  assert.deepEqual(item, {
    id: "sentry:9",
    source: "sentry",
    type: "error_assigned",
    title: "Issue 9",
    snippet: "culprit 9",
    url: "https://acme.sentry.io/issues/9/",
    createdAt: "2026-09-25T09:00:00Z",
    priority: 100,
    state: "unread",
    meta: {
      org: "acme",
      project: "api",
      level: "fatal",
      count: "1234",
      userCount: "3",
      culprit: "culprit 9",
      shortId: "API-9",
      category: "assigned",
    },
  });
});

test("a full page of 100 rows marks the pull partial", async () => {
  const issues = Array.from({ length: 100 }, (_, n) => ({
    id: String(n + 1),
    org: "acme",
  }));
  const { items, truncated } = await (() => {
    stub([{ slug: "acme" }], issues);
    return source().fetch();
  })();
  assert.equal(items.length, 100);
  assert.equal(truncated, true);
});

test("a next page with results marks the pull partial", async () => {
  stub([{ slug: "acme" }], [{ id: "1", org: "acme" }], {
    link: '<https://sentry.io/x?cursor=0:0:1>; rel="previous"; results="false", <https://sentry.io/x?cursor=0:100:0>; rel="next"; results="true"',
  });
  assert.equal((await source().fetch()).truncated, true);
});

test("a next link without results keeps the pull complete", async () => {
  stub([{ slug: "acme" }], [{ id: "1", org: "acme" }], {
    link: '<https://sentry.io/x?cursor=0:100:0>; rel="next"; results="false"',
  });
  assert.equal((await source().fetch()).truncated, false);
});

test("more than ten orgs polls the first ten and marks the pull partial", async () => {
  const orgs = Array.from({ length: 11 }, (_, n) => ({ slug: `org${n}` }));
  const seen = stub(orgs, []);
  const { truncated } = await source().fetch();
  const polled = new Set(
    seen
      .filter((u) => u.pathname.endsWith("/issues/"))
      .map((u) => u.pathname.split("/")[4]),
  );
  assert.equal(polled.size, 10);
  assert.ok(!polled.has("org10"));
  assert.equal(truncated, true);
});

test("a 403 org is skipped, the others still load, and the pull is partial", async () => {
  stub(
    [{ slug: "locked", forbidden: true }, { slug: "acme" }],
    [{ id: "1", org: "acme" }],
  );
  const { items, truncated } = await source().fetch();
  assert.deepEqual(
    items.map((i) => i.id),
    ["sentry:1"],
  );
  assert.equal(truncated, true);
});

test("org-scoped calls use an allowed region and never an outside host", async () => {
  const seen = stub(
    [
      { slug: "eu", regionUrl: "https://de.sentry.io" },
      { slug: "bad", regionUrl: "https://evil.example" },
    ],
    [
      { id: "1", org: "eu" },
      { id: "2", org: "bad" },
    ],
  );
  const { items } = await source().fetch();
  const origins = seen.map((u) => `${u.origin}${u.pathname}`);
  assert.ok(
    origins.includes("https://de.sentry.io/api/0/organizations/eu/issues/"),
  );
  assert.ok(
    origins.includes("https://sentry.io/api/0/organizations/bad/issues/"),
  );
  assert.ok(seen.every((u) => u.hostname !== "evil.example"));
  assert.equal(
    items.find((i) => i.id === "sentry:1")?.meta.regionUrl,
    "https://de.sentry.io",
  );
  assert.equal(
    items.find((i) => i.id === "sentry:2")?.meta.regionUrl,
    undefined,
  );
});

test("the region allowlist takes only https sentry.io origins", () => {
  assert.equal(allowedRegion("https://us.sentry.io"), "https://us.sentry.io");
  assert.equal(allowedRegion("https://sentry.io"), "https://sentry.io");
  assert.equal(allowedRegion("http://de.sentry.io"), null);
  assert.equal(allowedRegion("https://evilsentry.io"), null);
  assert.equal(allowedRegion("https://sentry.io.evil.example"), null);
  assert.equal(allowedRegion("https://de.sentry.io/path"), null);
  assert.equal(allowedRegion("not a url"), null);
  assert.equal(allowedRegion(undefined), null);
});

test("a 401 fails the poll with the auth error", async () => {
  stub([], [], { status: 401 });
  await assert.rejects(source().fetch(), SentryAuthError);
});

test("a 429 raises the rate-limit sentinel", async () => {
  stub([], [], { status: 429 });
  await assert.rejects(source().fetch(), RateLimited);
});

test("no credential fails the poll without a request", async () => {
  const seen = stub([], []);
  const empty = new SentrySource(() => Promise.resolve(null), 60_000);
  await assert.rejects(empty.fetch());
  assert.equal(seen.length, 0);
});

test("an item keeps only an http or https permalink as its url", () => {
  const query = {
    category: "unresolved",
    type: "error",
    query: "is:unresolved",
  } as const;
  const base = { id: "1", title: "t" };
  assert.equal(
    sentryItem(
      "acme",
      null,
      { ...base, permalink: "https://acme.sentry.io/issues/1/" },
      query,
    ).url,
    "https://acme.sentry.io/issues/1/",
  );
  for (const permalink of [
    "javascript:alert(1)",
    "data:text/html,x",
    "",
    null,
  ]) {
    assert.equal(
      sentryItem("acme", null, { ...base, permalink }, query).url,
      undefined,
    );
  }
});

test("a 403 that reports an exhausted rate limit raises the rate-limit sentinel instead of skipping the org", async () => {
  stub([], [], {
    status: 403,
    headers: { "x-sentry-rate-limit-remaining": "0" },
  });
  await assert.rejects(source().fetch(), RateLimited);
});

test("a 5xx on an issues query fails the whole pull", async () => {
  mock.method(globalThis, "fetch", (input: string) => {
    const url = new URL(input);
    return Promise.resolve(
      url.pathname === "/api/0/organizations/"
        ? json(200, [{ slug: "acme", links: { regionUrl: "" } }])
        : json(502, {}),
    );
  });
  await assert.rejects(source().fetch(), SentryRequestError);
});

test("a previous page with results and no next page keeps the pull complete", async () => {
  stub([{ slug: "acme" }], [{ id: "1", org: "acme" }], {
    link: '<https://sentry.io/x?cursor=0:0:1>; rel="previous"; results="true", <https://sentry.io/x?cursor=0:100:0>; rel="next"; results="false"',
  });
  const { truncated } = await source().fetch();
  assert.equal(truncated, false);
});
