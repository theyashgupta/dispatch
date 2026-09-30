import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const configPath = path.join(env.dispatchDir, "config.json");
const ghPath = path.join(env.binDir, "gh");
const GH_TOKEN = ["g14", "fake", "gh", "token"].join("-");
const GH_PASTED = ["g14", "fake", "pasted", "token"].join("-");
const LINEAR_KEY = "lin_api_g14_fake_key";
const SLACK_USER = "xoxp-g14-fake-user";

const express = (await import("express")).default;
const { connectionRouter } = await import("./connection.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
const { setOrchestrationConfig, getOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { rebuildSources } = await import("../adapters/source-gateway.js");
const { stopPollers } = await import("../adapters/poller.js");

const app = express();
app.use("/api", express.json(), connectionRouter);
app.use(httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/sources`;
const realFetch = globalThis.fetch;

after(() => {
  server.close();
  env.cleanup();
});

type Answer = () => Response | Promise<Response>;

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const LINEAR_VIEWER = () =>
  json(200, { data: { viewer: { id: "u1", name: "Ada", email: "a@x.dev" } } });
const LINEAR_REJECTED = () =>
  json(400, {
    errors: [{ message: "bad", extensions: { code: "AUTHENTICATION_ERROR" } }],
  });

let github: Answer;
let linear: Answer;
let slack: Answer;

function ghShim(token: string | null, sleep = 0): void {
  fs.writeFileSync(
    ghPath,
    token === null
      ? "#!/bin/sh\nexit 1\n"
      : `#!/bin/sh\nsleep ${sleep}\n[ "$1 $2" = "auth token" ] && echo ${token} && exit 0\nexit 1\n`,
    { mode: 0o755 },
  );
}

function writeConfig(): void {
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      port: 4700,
      sources: { linear: { apiKey: "", filters: { teams: ["keep"] } } },
    }),
    { mode: 0o600 },
  );
  setOrchestrationConfig({
    linearApiKey: "",
    sources: { linear: { apiKey: "" } },
  });
  rebuildSources(getOrchestrationConfig()!);
}

function corruptConfig(): void {
  fs.writeFileSync(configPath, "{ not json", { mode: 0o600 });
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

async function expectBody(
  method: string,
  route: string,
  body: unknown,
  status: number,
  text: string,
): Promise<void> {
  const res = await call(method, route, body);
  assert.equal(
    res.status,
    status,
    `${method} ${route} ${JSON.stringify(body)}`,
  );
  assert.equal(res.text, text);
}

const err = (error: string) => JSON.stringify({ error });

function holdFetch(target: "github" | "linear"): () => void {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const answer = target === "github" ? github : linear;
  const held: Answer = async () => {
    await gate;
    return answer();
  };
  if (target === "github") github = held;
  else linear = held;
  return release;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  github = () => json(200, { login: "g14-tester" });
  linear = LINEAR_VIEWER;
  slack = () =>
    json(200, { ok: true, url: "https://a.slack.com/", team: "A", user: "u" });
  ghShim(null);
  writeConfig();
  mock.method(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const host = new URL(url).hostname;
      if (host === "api.github.com") return Promise.resolve(github());
      if (host === "api.linear.app") return Promise.resolve(linear());
      if (host === "slack.com") return Promise.resolve(slack());
      return realFetch(input, init);
    },
  );
});

afterEach(() => {
  stopPollers();
  mock.restoreAll();
});

test("every route answers 404 unknown source for a source with no credential", async () => {
  const body = err("unknown source");
  for (const source of ["nope", "toString", "constructor"]) {
    await expectBody("GET", `/${source}/connection`, undefined, 404, body);
    await expectBody("PUT", `/${source}/key`, undefined, 404, body);
    await expectBody("PUT", `/${source}/key`, { apiKey: "x" }, 404, body);
    await expectBody("DELETE", `/${source}/key`, undefined, 404, body);
    await expectBody("POST", `/${source}/connect`, undefined, 404, body);
    await expectBody("POST", `/${source}/disable`, undefined, 404, body);
  }
  await expectBody("POST", "/linear/connect", undefined, 404, body);
  await expectBody("POST", "/linear/disable", undefined, 404, body);
});

test("PUT key answers 400 apiKey is required for a missing or blank key", async () => {
  const bad: unknown[] = [
    undefined,
    [],
    {},
    { apiKey: 5 },
    { apiKey: null },
    { apiKey: "" },
    { apiKey: "  " },
    { apiKey: ["a"] },
  ];
  for (const source of ["linear", "github", "sentry", "slack"]) {
    for (const body of bad) {
      await expectBody(
        "PUT",
        `/${source}/key`,
        body,
        400,
        err("apiKey is required"),
      );
    }
  }
});

test("PUT key answers 400 rejected for a key that is not printable ASCII, before any call", async () => {
  let calls = 0;
  github = () => {
    calls += 1;
    return json(200, { login: "x" });
  };
  linear = () => {
    calls += 1;
    return LINEAR_VIEWER();
  };
  for (const source of ["linear", "github", "slack"]) {
    for (const apiKey of ["a\nb", "a b", "tokén", "\u0001x", " a\tb "]) {
      await expectBody(
        "PUT",
        `/${source}/key`,
        { apiKey },
        400,
        err("rejected"),
      );
    }
  }
  assert.equal(calls, 0);
});

test("PUT github key answers 400 rejected, 502 unreachable and 403 sso-required from the provider check", async () => {
  github = () => json(401, {});
  await expectBody(
    "PUT",
    "/github/key",
    { apiKey: GH_PASTED },
    400,
    err("rejected"),
  );
  github = () => json(503, {});
  await expectBody(
    "PUT",
    "/github/key",
    { apiKey: GH_PASTED },
    502,
    err("unreachable"),
  );
  github = () =>
    json(
      403,
      { message: "SAML" },
      { "x-github-sso": "required; url=https://github.com/orgs/acme/sso?x=1" },
    );
  await expectBody(
    "PUT",
    "/github/key",
    { apiKey: GH_PASTED },
    403,
    '{"error":"sso-required","ssoUrl":"https://github.com/orgs/acme/sso?x=1"}',
  );
  github = () => json(403, { message: "SAML" }, { "x-github-sso": "required" });
  await expectBody(
    "PUT",
    "/github/key",
    { apiKey: GH_PASTED },
    403,
    err("sso-required"),
  );
});

test("PUT slack key answers 400 rejected with the provider code, and 502 unreachable", async () => {
  slack = () => json(200, { ok: false, error: "token_revoked" });
  await expectBody(
    "PUT",
    "/slack/key",
    { apiKey: SLACK_USER },
    400,
    '{"error":"rejected","providerError":"token_revoked"}',
  );
  slack = () => json(200, { ok: false, error: "Not_A_Code!" });
  await expectBody(
    "PUT",
    "/slack/key",
    { apiKey: SLACK_USER },
    502,
    err("unreachable"),
  );
  slack = () => json(502, {});
  await expectBody(
    "PUT",
    "/slack/key",
    { apiKey: SLACK_USER },
    502,
    err("unreachable"),
  );
  await expectBody(
    "PUT",
    "/slack/key",
    { apiKey: "xoxc-g14-fake-session" },
    400,
    err("rejected"),
  );
});

test("PUT github key answers 409 superseded when a DELETE overtakes it", async () => {
  const release = holdFetch("github");
  const saving = call("PUT", "/github/key", { apiKey: GH_PASTED });
  await wait(100);
  assert.equal((await call("DELETE", "/github/key")).status, 204);
  release();
  const res = await saving;
  assert.equal(res.status, 409);
  assert.equal(res.text, err("superseded"));
});

test("PUT github key answers 500 save-failed when the config cannot be read", async () => {
  corruptConfig();
  await expectBody(
    "PUT",
    "/github/key",
    { apiKey: GH_PASTED },
    500,
    err("save-failed"),
  );
});

test("POST connect answers 400 no-credential without a credential", async () => {
  await expectBody(
    "POST",
    "/github/connect",
    undefined,
    400,
    err("no-credential"),
  );
});

test("POST connect answers 400 rejected, 502 unreachable and 403 sso-required from the provider check", async () => {
  ghShim(GH_TOKEN);
  github = () => json(401, {});
  await expectBody("POST", "/github/connect", undefined, 400, err("rejected"));
  github = () => json(503, {});
  await expectBody(
    "POST",
    "/github/connect",
    undefined,
    502,
    err("unreachable"),
  );
  github = () =>
    json(
      403,
      { message: "SAML" },
      { "x-github-sso": "required; url=https://github.com/orgs/acme/sso?x=1" },
    );
  await expectBody(
    "POST",
    "/github/connect",
    undefined,
    403,
    '{"error":"sso-required","ssoUrl":"https://github.com/orgs/acme/sso?x=1"}',
  );
});

test("POST connect answers 409 superseded when a DELETE overtakes it", async () => {
  ghShim(GH_TOKEN, 0.5);
  const connecting = call("POST", "/github/connect");
  await wait(100);
  assert.equal((await call("DELETE", "/github/key")).status, 204);
  const res = await connecting;
  assert.equal(res.status, 409);
  assert.equal(res.text, err("superseded"));
});

test("POST connect answers 500 save-failed when the config cannot be read", async () => {
  ghShim(GH_TOKEN);
  corruptConfig();
  await expectBody(
    "POST",
    "/github/connect",
    undefined,
    500,
    err("save-failed"),
  );
});

test("DELETE key answers 500 save-failed when the config cannot be read", async () => {
  corruptConfig();
  await expectBody("DELETE", "/github/key", undefined, 500, err("save-failed"));
  await expectBody("DELETE", "/linear/key", undefined, 500, err("save-failed"));
});

test("POST disable answers 500 save-failed when the config cannot be read", async () => {
  corruptConfig();
  await expectBody(
    "POST",
    "/github/disable",
    undefined,
    500,
    err("save-failed"),
  );
});

test("PUT linear key answers 400 rejected and 502 unreachable from the provider check", async () => {
  linear = LINEAR_REJECTED;
  await expectBody(
    "PUT",
    "/linear/key",
    { apiKey: LINEAR_KEY },
    400,
    err("rejected"),
  );
  linear = () => {
    throw new TypeError("fetch failed");
  };
  await expectBody(
    "PUT",
    "/linear/key",
    { apiKey: LINEAR_KEY },
    502,
    err("unreachable"),
  );
});

test("PUT linear key answers 409 superseded when a DELETE overtakes it", async () => {
  const release = holdFetch("linear");
  const saving = call("PUT", "/linear/key", { apiKey: LINEAR_KEY });
  await wait(100);
  assert.equal((await call("DELETE", "/linear/key")).status, 204);
  release();
  const res = await saving;
  assert.equal(res.status, 409);
  assert.equal(res.text, err("superseded"));
});

test("PUT linear key answers 500 save-failed when the config cannot be read", async () => {
  corruptConfig();
  await expectBody(
    "PUT",
    "/linear/key",
    { apiKey: LINEAR_KEY },
    500,
    err("save-failed"),
  );
});
