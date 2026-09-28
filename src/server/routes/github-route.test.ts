import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";
import { makeFakeSource } from "../test-support/fake-source.js";

const env = isolateEnv();
const ghPath = path.join(env.binDir, "gh");
const GH_TOKEN = ["g5", "fake", "gh", "token"].join("-");
const SHA = "b".repeat(40);

const express = (await import("express")).default;
const { githubRouter } = await import("./github.route.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { rebuildSources } = await import("../adapters/source-gateway.js");
const { startPollers, stopPollers } = await import("../adapters/poller.js");

const app = express();
app.use("/api", express.json(), githubRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
const realFetch = globalThis.fetch;

after(() => {
  server.close();
  env.cleanup();
});

interface GithubCall {
  method: string;
  path: string;
  body: unknown;
  auth: string;
}

let calls: GithubCall[] = [];
let answer: (call: GithubCall) => Response = () => json(200, {});

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

const pull = {
  title: "Fix race",
  body: "Body",
  html_url: "https://github.com/acme/api/pull/12",
  user: { login: "mchen" },
  state: "open",
  merged_at: null,
  draft: false,
  base: { ref: "main" },
  head: { ref: "fix/race", sha: SHA },
  additions: 1,
  deletions: 0,
  changed_files: 1,
};

function detailAnswer(call: GithubCall): Response {
  if (call.path.endsWith("/files")) return json(200, []);
  if (call.path.endsWith("/check-runs")) return json(200, { check_runs: [] });
  if (call.path.endsWith("/status")) return json(200, { statuses: [] });
  return json(200, pull);
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

beforeEach(() => {
  calls = [];
  answer = detailAnswer;
  fs.writeFileSync(
    ghPath,
    `#!/bin/sh\n[ "$1 $2" = "auth token" ] && echo ${GH_TOKEN} && exit 0\nexit 1\n`,
    { mode: 0o755 },
  );
  setOrchestrationConfig({
    linearApiKey: "",
    sources: { linear: { apiKey: "" }, github: { enabled: true } },
  });
  rebuildSources({ linearApiKey: "", sources: { linear: { apiKey: "" } } });
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.host === "api.github.com") {
        const record: GithubCall = {
          method: init?.method ?? "GET",
          path: url.pathname,
          body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
          auth: new Headers(init?.headers).get("authorization") ?? "",
        };
        calls.push(record);
        return answer(record);
      }
      return realFetch(input, init);
    },
  );
});

afterEach(() => {
  stopPollers();
  mock.restoreAll();
});

test("an invalid owner, repo or number answers 400 before any GitHub call", async () => {
  for (const route of [
    "/github/pr/acme/api/abc",
    "/github/pr/acme/api/0",
    "/github/pr/ac%20me/api/12",
    "/github/pr/acme/api%3Bx/12",
    "/github/pr/acme/api/12345678901",
  ]) {
    const res = await call("GET", route);
    assert.equal(res.status, 400, route);
  }
  assert.equal(calls.length, 0);
});

/** Send a GET with the path exactly as given, the way curl does, so dot segments stay encoded. */
function rawGet(route: string): Promise<number> {
  const { port } = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: `/api${route}` },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
  });
}

test("an owner or repo made only of dots answers 400 before any GitHub call", async () => {
  for (const route of [
    "/github/pr/%2E%2E/api/12",
    "/github/pr/acme/%2E%2E/12",
    "/github/pr/%2E/api/12",
  ]) {
    assert.equal(await rawGet(route), 400, route);
  }
  assert.equal(calls.length, 0);
});

test("the detail answers the mapped PR with the gh token in the header only", async () => {
  const res = await call("GET", "/github/pr/acme/api/12");
  assert.equal(res.status, 200);
  const body = JSON.parse(res.text) as { headSha: string; title: string };
  assert.equal(body.headSha, SHA);
  assert.equal(body.title, "Fix race");
  assert.equal(calls[0]?.auth, `Bearer ${GH_TOKEN}`);
  assert.ok(!res.text.includes(GH_TOKEN));
});

test("GitHub failures map to error kinds without the token or the raw body", async () => {
  const cases: [Response, number, Record<string, unknown>][] = [
    [json(401, { message: GH_TOKEN }), 401, { error: "rejected" }],
    [json(404, { message: "Not Found" }), 404, { error: "not-found" }],
    [
      json(
        403,
        { message: "SAML" },
        {
          "x-github-sso": "required; url=https://github.com/orgs/acme/sso?x=1",
        },
      ),
      403,
      { error: "sso-required", ssoUrl: "https://github.com/orgs/acme/sso?x=1" },
    ],
    [
      json(403, { message: "slow" }, { "x-ratelimit-remaining": "0" }),
      429,
      { error: "rate-limited" },
    ],
    [json(500, { message: GH_TOKEN }), 502, { error: "unreachable" }],
  ];
  for (const [response, status, body] of cases) {
    answer = () => response.clone();
    const res = await call("GET", "/github/pr/acme/api/12");
    assert.equal(res.status, status);
    assert.deepEqual(JSON.parse(res.text), body);
    assert.ok(!res.text.includes(GH_TOKEN));
  }
});

test("no credential answers 401 no-credential", async () => {
  fs.writeFileSync(ghPath, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const res = await call("GET", "/github/pr/acme/api/12");
  assert.equal(res.status, 401);
  assert.deepEqual(JSON.parse(res.text), { error: "no-credential" });
  assert.equal(calls.length, 0);
});

test("a disconnected source answers 401 no-credential although gh is logged in", async () => {
  setOrchestrationConfig({
    linearApiKey: "",
    sources: { linear: { apiKey: "" }, github: { enabled: false } },
  });
  for (const [method, route, body] of [
    ["GET", "/github/pr/acme/api/12", undefined],
    ["POST", "/github/pr/acme/api/12/review", { event: "APPROVE" }],
    ["POST", "/github/pr/acme/api/12/merge", { sha: SHA }],
  ] as const) {
    const res = await call(method, route, body);
    assert.equal(res.status, 401);
    assert.deepEqual(JSON.parse(res.text), { error: "no-credential" });
  }
  assert.equal(calls.length, 0);
});

test("a review with an unknown event or a missing body answers 400 and posts nothing", async () => {
  const bad = [
    { event: "MERGE" },
    { event: "REQUEST_CHANGES" },
    { event: "COMMENT", body: "   " },
    { event: "COMMENT", body: 5 },
    { event: "COMMENT", body: "x".repeat(20001) },
    {},
  ];
  for (const review of bad) {
    const res = await call("POST", "/github/pr/acme/api/12/review", review);
    assert.equal(res.status, 400, JSON.stringify(review).slice(0, 60));
  }
  assert.equal(calls.length, 0);
});

test("approve and comment post reviews and each triggers a GitHub poll", async () => {
  let polls = 0;
  startPollers([
    makeFakeSource({
      id: "github",
      pollIntervalMs: 3_600_000,
      fetch: () => {
        polls += 1;
        return Promise.resolve({ issues: [], items: [], truncated: true });
      },
    }),
  ]);
  const settle = () => new Promise((r) => setTimeout(r, 30));
  await settle();
  const before = polls;
  answer = () => json(200, { id: 1 });
  assert.equal(
    (await call("POST", "/github/pr/acme/api/12/review", { event: "APPROVE" }))
      .status,
    200,
  );
  await settle();
  assert.equal(polls, before + 1);
  assert.equal(
    (
      await call("POST", "/github/pr/acme/api/12/review", {
        event: "COMMENT",
        body: " Looks good ",
      })
    ).status,
    200,
  );
  await settle();
  assert.equal(polls, before + 2);
  assert.deepEqual(
    calls.map((c) => [c.method, c.path, c.body]),
    [
      ["POST", "/repos/acme/api/pulls/12/reviews", { event: "APPROVE" }],
      [
        "POST",
        "/repos/acme/api/pulls/12/reviews",
        { event: "COMMENT", body: "Looks good" },
      ],
    ],
  );
});

test("a failed review triggers no poll", async () => {
  let polls = 0;
  startPollers([
    makeFakeSource({
      id: "github",
      pollIntervalMs: 3_600_000,
      fetch: () => {
        polls += 1;
        return Promise.resolve({ issues: [], items: [], truncated: true });
      },
    }),
  ]);
  await new Promise((r) => setTimeout(r, 30));
  const before = polls;
  answer = () => json(401, {});
  assert.equal(
    (await call("POST", "/github/pr/acme/api/12/review", { event: "APPROVE" }))
      .status,
    401,
  );
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(polls, before);
});

test("a review GitHub refuses answers 422 with GitHub's message", async () => {
  answer = () =>
    json(422, { message: "Can not approve your own pull request" });
  const res = await call("POST", "/github/pr/acme/api/12/review", {
    event: "APPROVE",
  });
  assert.equal(res.status, 422);
  assert.deepEqual(JSON.parse(res.text), {
    error: "refused",
    message: "Can not approve your own pull request",
  });
});

test("merge sends squash with the given head sha", async () => {
  answer = () => json(200, { merged: true });
  const res = await call("POST", "/github/pr/acme/api/12/merge", { sha: SHA });
  assert.equal(res.status, 200);
  assert.deepEqual(calls[0], {
    method: "PUT",
    path: "/repos/acme/api/pulls/12/merge",
    body: { merge_method: "squash", sha: SHA },
    auth: `Bearer ${GH_TOKEN}`,
  });
});

test("merge refuses a missing or malformed sha before any GitHub call", async () => {
  for (const body of [{}, { sha: "abc" }, { sha: "Z".repeat(40) }]) {
    assert.equal(
      (await call("POST", "/github/pr/acme/api/12/merge", body)).status,
      400,
    );
  }
  assert.equal(calls.length, 0);
});

test("a PR GitHub will not merge answers 409 with GitHub's message", async () => {
  for (const status of [405, 409]) {
    answer = () => json(status, { message: "Head branch was modified." });
    const res = await call("POST", "/github/pr/acme/api/12/merge", {
      sha: SHA,
    });
    assert.equal(res.status, 409);
    assert.deepEqual(JSON.parse(res.text), {
      error: "not-mergeable",
      message: "Head branch was modified.",
    });
  }
});

test("a network failure answers 502 unreachable without the token", async () => {
  answer = () => {
    throw new TypeError("fetch failed");
  };
  const res = await call("GET", "/github/pr/acme/api/12");
  assert.equal(res.status, 502);
  assert.deepEqual(JSON.parse(res.text), { error: "unreachable" });
  assert.ok(!res.text.includes(GH_TOKEN));
});

test("request changes posts its body and a confirmed merge triggers a GitHub poll", async () => {
  let polls = 0;
  startPollers([
    makeFakeSource({
      id: "github",
      pollIntervalMs: 3_600_000,
      fetch: () => {
        polls += 1;
        return Promise.resolve({ issues: [], items: [], truncated: true });
      },
    }),
  ]);
  const settle = () => new Promise((r) => setTimeout(r, 30));
  await settle();
  const before = polls;
  answer = () => json(200, { merged: true });
  const changes = await call("POST", "/github/pr/acme/api/12/review", {
    event: "REQUEST_CHANGES",
    body: "Add a test",
  });
  assert.equal(changes.status, 200);
  const merged = await call("POST", "/github/pr/acme/api/12/merge", {
    sha: SHA,
  });
  assert.equal(merged.status, 200);
  await settle();
  assert.equal(polls, before + 2);
  assert.deepEqual(calls[0]?.body, {
    event: "REQUEST_CHANGES",
    body: "Add a test",
  });
});

test("a review body over 20000 characters answers 400 and posts nothing", async () => {
  const res = await call("POST", "/github/pr/acme/api/12/review", {
    event: "COMMENT",
    body: "x".repeat(20001),
  });
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test("no route writes the token to the console", async () => {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  mock.method(console, "log", capture);
  mock.method(console, "error", capture);
  mock.method(console, "warn", capture);
  await call("GET", "/github/pr/acme/api/12");
  answer = () => json(401, { message: "Bad credentials" });
  await call("GET", "/github/pr/acme/api/12");
  await call("POST", "/github/pr/acme/api/12/review", { event: "APPROVE" });
  answer = () => {
    throw new TypeError("fetch failed");
  };
  await call("POST", "/github/pr/acme/api/12/merge", { sha: SHA });
  assert.ok(lines.every((line) => !line.includes(GH_TOKEN)));
});
