import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const ghPath = path.join(env.binDir, "gh");
const GH_TOKEN = ["g5", "fake", "gh", "token"].join("-");
const SHA = "b".repeat(40);

const express = (await import("express")).default;
const { githubRouter } = await import("./github.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { rebuildSources } = await import("../adapters/source-gateway.js");
const { stopPollers } = await import("../adapters/poller.js");

const app = express();
app.use("/api", express.json(), githubRouter);
app.use(httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}/api`;
const realFetch = globalThis.fetch;

after(() => {
  server.close();
  env.cleanup();
});

let answer: () => Response = () => json(200, {});
let githubCalls = 0;

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

/** Send a GET with the path exactly as given, so dot segments stay encoded. */
function rawGet(route: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: `/api${route}` },
      (res) => {
        let text = "";
        res.on("data", (chunk: Buffer) => {
          text += chunk.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
  });
}

async function expectError(
  res: Promise<{ status: number; text: string }>,
  status: number,
  text: string,
): Promise<void> {
  const got = await res;
  assert.equal(got.status, status);
  assert.equal(got.text, text);
}

const PR = "/github/pr/acme/api/12";
const get = () => call("GET", PR);
const review = (body?: unknown) => call("POST", `${PR}/review`, body);
const merge = (body?: unknown) => call("POST", `${PR}/merge`, body);

beforeEach(() => {
  githubCalls = 0;
  answer = () => json(200, {});
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
        githubCalls += 1;
        return answer();
      }
      return realFetch(input, init);
    },
  );
});

afterEach(() => {
  stopPollers();
  mock.restoreAll();
});

const INVALID_PR = '{"error":"invalid pull request"}';

test("a malformed owner, repo or number answers 400 invalid pull request on all three routes", async () => {
  const bad = [
    "acme/api/abc",
    "acme/api/0",
    "acme/api/012",
    "ac%20me/api/12",
    "acme/api%3Bx/12",
    "acme/api/12345678901",
    `${"a".repeat(101)}/api/12`,
  ];
  for (const tail of bad) {
    await expectError(call("GET", `/github/pr/${tail}`), 400, INVALID_PR);
    await expectError(
      call("POST", `/github/pr/${tail}/review`, { event: "APPROVE" }),
      400,
      INVALID_PR,
    );
    await expectError(
      call("POST", `/github/pr/${tail}/merge`, { sha: SHA }),
      400,
      INVALID_PR,
    );
  }
  assert.equal(githubCalls, 0);
});

test("an owner or repo made only of dots answers 400 invalid pull request", async () => {
  for (const route of [
    "/github/pr/%2E%2E/api/12",
    "/github/pr/acme/%2E%2E/12",
    "/github/pr/%2E/api/12",
  ]) {
    await expectError(rawGet(route), 400, INVALID_PR);
  }
});

test("a bad pull request answers before the body is checked", async () => {
  await expectError(
    call("POST", "/github/pr/acme/api/abc/review", {}),
    400,
    INVALID_PR,
  );
  await expectError(
    call("POST", "/github/pr/acme/api/abc/merge", {}),
    400,
    INVALID_PR,
  );
});

test("a bad review answers 400 invalid review and posts nothing", async () => {
  const bad: unknown[] = [
    undefined,
    [],
    {},
    { event: 5 },
    { event: "MERGE" },
    { event: "approve" },
    { event: "REQUEST_CHANGES" },
    { event: "COMMENT" },
    { event: "COMMENT", body: "   " },
    { event: "COMMENT", body: 5 },
    { event: "COMMENT", body: null },
    { event: "APPROVE", body: 5 },
    { event: "APPROVE", body: null },
    { event: "APPROVE", body: "x".repeat(20001) },
    { event: "COMMENT", body: "x".repeat(20001) },
  ];
  for (const body of bad) {
    await expectError(review(body), 400, '{"error":"invalid review"}');
  }
  assert.equal(githubCalls, 0);
});

test("a bad merge sha answers 400 invalid sha and calls nothing", async () => {
  const bad: unknown[] = [
    undefined,
    [],
    {},
    { sha: 5 },
    { sha: null },
    { sha: "abc" },
    { sha: "Z".repeat(40) },
    { sha: "B".repeat(40) },
    { sha: `${SHA}0` },
  ];
  for (const body of bad) {
    await expectError(merge(body), 400, '{"error":"invalid sha"}');
  }
  assert.equal(githubCalls, 0);
});

const requests: [string, () => Promise<{ status: number; text: string }>][] = [
  ["detail", get],
  ["review", () => review({ event: "APPROVE" })],
  ["merge", () => merge({ sha: SHA })],
];

for (const [name, send] of requests) {
  test(`${name} answers 401 no-credential without a gh token and on a disconnected source`, async () => {
    const text = '{"error":"no-credential"}';
    fs.writeFileSync(ghPath, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    await expectError(send(), 401, text);
    fs.writeFileSync(
      ghPath,
      `#!/bin/sh\n[ "$1 $2" = "auth token" ] && echo ${GH_TOKEN} && exit 0\nexit 1\n`,
      { mode: 0o755 },
    );
    setOrchestrationConfig({
      linearApiKey: "",
      sources: { linear: { apiKey: "" }, github: { enabled: false } },
    });
    await expectError(send(), 401, text);
    assert.equal(githubCalls, 0);
  });

  const failures: [string, () => Response, number, string][] = [
    ["401 rejected", () => json(401, {}), 401, '{"error":"rejected"}'],
    [
      "403 sso-required with a url",
      () =>
        json(
          403,
          {},
          {
            "x-github-sso":
              "required; url=https://github.com/orgs/acme/sso?x=1",
          },
        ),
      403,
      '{"error":"sso-required","ssoUrl":"https://github.com/orgs/acme/sso?x=1"}',
    ],
    [
      "403 sso-required without a url",
      () => json(403, {}, { "x-github-sso": "required" }),
      403,
      '{"error":"sso-required"}',
    ],
    [
      "429 rate-limited on a 429",
      () => json(429, {}),
      429,
      '{"error":"rate-limited"}',
    ],
    [
      "429 rate-limited on an exhausted 403",
      () => json(403, {}, { "x-ratelimit-remaining": "0" }),
      429,
      '{"error":"rate-limited"}',
    ],
    ["404 not-found", () => json(404, {}), 404, '{"error":"not-found"}'],
    [
      "409 not-mergeable with the message on a 405",
      () => json(405, { message: "Not allowed" }),
      409,
      '{"error":"not-mergeable","message":"Not allowed"}',
    ],
    [
      "409 not-mergeable with the message on a 409",
      () => json(409, { message: "Head branch was modified." }),
      409,
      '{"error":"not-mergeable","message":"Head branch was modified."}',
    ],
    [
      "409 not-mergeable without a message",
      () => json(409, {}),
      409,
      '{"error":"not-mergeable"}',
    ],
    [
      "422 refused with the message",
      () => json(422, { message: "Can not approve your own pull request" }),
      422,
      '{"error":"refused","message":"Can not approve your own pull request"}',
    ],
    [
      "422 refused without a message",
      () => json(422, {}),
      422,
      '{"error":"refused"}',
    ],
    [
      "502 unreachable on a 500",
      () => json(500, {}),
      502,
      '{"error":"unreachable"}',
    ],
    [
      "502 unreachable on a plain 403",
      () => json(403, {}),
      502,
      '{"error":"unreachable"}',
    ],
    [
      "502 unreachable on a network failure",
      () => {
        throw new TypeError("fetch failed");
      },
      502,
      '{"error":"unreachable"}',
    ],
  ];
  for (const [label, reply, status, text] of failures) {
    test(`${name} answers ${label}`, async () => {
      answer = reply;
      await expectError(send(), status, text);
    });
  }
}
