import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  connectSource,
  getLinearFilters,
  getLinearOptions,
  getSourceConnection,
  listSlackChannels,
  resolveSlackChannel,
  saveLinearFilters,
  saveSlackChannels,
  saveSourceKey,
} from "./connections-api.js";
import {
  connectionsKeys,
  linearFiltersQueryOptions,
  linearOptionsQueryOptions,
  linearWorkflowQueryOptions,
  savedSlackChannelsQueryOptions,
  slackChannelsQueryOptions,
  sourceConnectionQueryOptions,
} from "./connections-queries.js";

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

const filters = {
  assignees: [],
  projects: [],
  teams: [],
  currentCycle: false,
  includeActive: false,
};

test("connectionsKeys has the documented shape", () => {
  assert.deepEqual(connectionsKeys.all, ["connections"]);
  assert.deepEqual(connectionsKeys.detail("linear"), [
    "connections",
    "source",
    "linear",
  ]);
  assert.deepEqual(connectionsKeys.linearFilters, [
    "connections",
    "linear",
    "filters",
  ]);
  assert.deepEqual(connectionsKeys.linearOptions("teams"), [
    "connections",
    "linear",
    "options",
    "teams",
  ]);
  assert.deepEqual(connectionsKeys.linearWorkflow, [
    "connections",
    "linear",
    "workflow",
  ]);
  assert.deepEqual(connectionsKeys.savedSlackChannels, [
    "connections",
    "slack",
    "saved-channels",
  ]);
  assert.deepEqual(connectionsKeys.slackChannels, [
    "connections",
    "slack",
    "channels",
  ]);
});

test("sourceConnectionQueryOptions keys on the source and requests its connection", async () => {
  const options = sourceConnectionQueryOptions("github");
  assert.deepEqual(options.queryKey, ["connections", "source", "github"]);
  reply(200, { connected: true });
  await newClient().fetchQuery(options);
  assert.equal(calls[0]?.url, "/api/sources/github/connection");
});

test("linearFiltersQueryOptions requests the Linear filters", async () => {
  const options = linearFiltersQueryOptions();
  assert.deepEqual(options.queryKey, ["connections", "linear", "filters"]);
  reply(200, { filters, capabilities: {} });
  await newClient().fetchQuery(options);
  assert.equal(calls[0]?.url, "/api/sources/linear/filters");
});

test("linearOptionsQueryOptions keys on the dimension and requests its options", async () => {
  const options = linearOptionsQueryOptions("projects");
  assert.deepEqual(options.queryKey, [
    "connections",
    "linear",
    "options",
    "projects",
  ]);
  reply(200, { options: [] });
  await newClient().fetchQuery(options);
  assert.equal(calls[0]?.url, "/api/sources/linear/options?dimension=projects");
});

test("linearWorkflowQueryOptions requests the Linear workflow", async () => {
  const options = linearWorkflowQueryOptions();
  assert.deepEqual(options.queryKey, ["connections", "linear", "workflow"]);
  assert.equal(options.staleTime, 0);
  reply(200, { viewer: {}, teams: [] });
  await newClient().fetchQuery(options);
  assert.equal(calls[0]?.url, "/api/sources/linear/workflow");
});

test("savedSlackChannelsQueryOptions requests the saved Slack channels", async () => {
  const options = savedSlackChannelsQueryOptions();
  assert.deepEqual(options.queryKey, [
    "connections",
    "slack",
    "saved-channels",
  ]);
  assert.equal(options.staleTime, 0);
  reply(200, { channels: [] });
  assert.deepEqual(await newClient().fetchQuery(options), []);
  assert.equal(calls[0]?.url, "/api/sources/slack/channels");
});

test("slackChannelsQueryOptions requests the Slack channel picker list", async () => {
  const options = slackChannelsQueryOptions();
  assert.deepEqual(options.queryKey, ["connections", "slack", "channels"]);
  assert.equal(options.staleTime, 0);
  reply(200, { channels: [], truncated: false });
  assert.deepEqual(await newClient().fetchQuery(options), {
    ok: true,
    channels: [],
    truncated: false,
  });
  assert.equal(calls[0]?.url, "/api/slack/channels");
});

test("getLinearFilters resolves the body on a 200", async () => {
  reply(200, { filters, capabilities: { teams: true } }, "OK");
  assert.deepEqual(await getLinearFilters(), {
    filters,
    capabilities: { teams: true },
  });
});

test("getLinearFilters throws on a failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    getLinearFilters(),
    new Error("getLinearFilters failed: 500 Internal Server Error"),
  );
});

test("getLinearOptions resolves the options and the truncated flag on a 200", async () => {
  reply(200, { options: [{ id: "1", name: "One" }], truncated: true }, "OK");
  assert.deepEqual(await getLinearOptions("assignees"), {
    options: [{ id: "1", name: "One" }],
    truncated: true,
  });
});

test("getLinearOptions reads a missing truncated flag as false", async () => {
  reply(200, { options: [] }, "OK");
  assert.deepEqual(await getLinearOptions("teams"), {
    options: [],
    truncated: false,
  });
});

test("getLinearOptions throws on a 502", async () => {
  reply(502, { error: "upstream" }, "Bad Gateway");
  await assert.rejects(
    getLinearOptions("teams"),
    new Error("getLinearOptions failed: 502 Bad Gateway"),
  );
});

test("getSourceConnection resolves the body on a 200", async () => {
  reply(200, { connected: true }, "OK");
  assert.deepEqual(await getSourceConnection("linear"), { connected: true });
});

test("getSourceConnection throws with the status only on a failure", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    getSourceConnection("linear"),
    new Error("getSourceConnection failed: 500"),
  );
});

test("saveLinearFilters resolves ok on a 200", async () => {
  reply(200, {}, "OK");
  assert.deepEqual(await saveLinearFilters(filters), { ok: true });
  assert.equal(calls[0]?.url, "/api/sources/linear/filters");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ filters }));
});

test("saveLinearFilters carries the validation error on a 400", async () => {
  reply(400, { error: "unknown dimension" }, "Bad Request");
  assert.deepEqual(await saveLinearFilters(filters), {
    ok: false,
    error: "unknown dimension",
  });
});

test("saveLinearFilters falls back to the save copy on a 400 with no error", async () => {
  reply(400, {}, "Bad Request");
  assert.deepEqual(await saveLinearFilters(filters), {
    ok: false,
    error: "Couldn't save filters.",
  });
});

test("saveLinearFilters throws on any other failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    saveLinearFilters(filters),
    new Error("saveLinearFilters failed: 500 Internal Server Error"),
  );
});

const keyCalls = [
  [
    "saveSourceKey",
    () => saveSourceKey("git hub", "tok"),
    "/api/sources/git%20hub/key",
    "PUT",
  ],
  [
    "connectSource",
    () => connectSource("git hub"),
    "/api/sources/git%20hub/connect",
    "POST",
  ],
] as const;

for (const [name, call, url, method] of keyCalls) {
  test(`${name} requests ${method} ${url}`, async () => {
    reply(200, {}, "OK");
    await call();
    assert.equal(calls[0]?.url, url);
    assert.equal(calls[0]?.init?.method, method);
  });

  test(`${name} resolves ok with the account on a 200`, async () => {
    reply(200, { account: "octocat" }, "OK");
    assert.deepEqual(await call(), { ok: true, account: "octocat" });
  });

  test(`${name} resolves a bare ok on a 200 with no account`, async () => {
    reply(200, {}, "OK");
    assert.deepEqual(await call(), { ok: true });
  });

  test(`${name} resolves a bare ok on a 200 with an empty body`, async () => {
    reply(200, "", "OK");
    assert.deepEqual(await call(), { ok: true });
  });

  for (const kind of [
    "rejected",
    "unreachable",
    "sso-required",
    "superseded",
    "no-credential",
  ]) {
    test(`${name} maps the ${kind} error kind from the body`, async () => {
      reply(500, { error: kind }, "Internal Server Error");
      assert.deepEqual(await call(), { ok: false, reason: kind });
    });
  }

  for (const [status, statusText, reason] of [
    [400, "Bad Request", "rejected"],
    [502, "Bad Gateway", "unreachable"],
    [409, "Conflict", "superseded"],
    [500, "Internal Server Error", "failed"],
    [401, "Unauthorized", "failed"],
  ] as const) {
    test(`${name} falls back to ${reason} on a ${status} with no error kind`, async () => {
      reply(status, {}, statusText);
      assert.deepEqual(await call(), { ok: false, reason });
    });
  }

  test(`${name} falls back on the status when the error kind is unknown`, async () => {
    reply(502, { error: "weird" }, "Bad Gateway");
    assert.deepEqual(await call(), { ok: false, reason: "unreachable" });
  });

  test(`${name} falls back on the status when the error is not a string`, async () => {
    reply(409, { error: 7 }, "Conflict");
    assert.deepEqual(await call(), { ok: false, reason: "superseded" });
  });

  test(`${name} falls back on the status for a non-JSON failure body`, async () => {
    reply(502, "<html>bad gateway</html>", "Bad Gateway");
    assert.deepEqual(await call(), { ok: false, reason: "unreachable" });
  });

  test(`${name} reads a 200 with a non-JSON body as failed`, async () => {
    reply(200, "<html>", "OK");
    assert.deepEqual(await call(), { ok: false, reason: "failed" });
  });

  test(`${name} keeps a plain lowercase provider error`, async () => {
    reply(400, { error: "rejected", providerError: "invalid_auth" }, "x");
    assert.deepEqual(await call(), {
      ok: false,
      reason: "rejected",
      providerError: "invalid_auth",
    });
  });

  for (const providerError of ["Invalid Auth!", "INVALID", "", 7, null]) {
    test(`${name} drops the provider error ${JSON.stringify(providerError)}`, async () => {
      reply(400, { error: "rejected", providerError }, "Bad Request");
      assert.deepEqual(await call(), { ok: false, reason: "rejected" });
    });
  }

  test(`${name} rejects on a network failure`, async () => {
    const failure = new TypeError("Failed to fetch");
    globalThis.fetch = () => Promise.reject(failure);
    await assert.rejects(call(), (err) => err === failure);
  });
}

test("saveSourceKey sends the key once in a JSON body", async () => {
  reply(200, {}, "OK");
  await saveSourceKey("linear", "lin_key");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ apiKey: "lin_key" }));
  assert.deepEqual(calls[0]?.init?.headers, {
    "Content-Type": "application/json",
  });
});

test("connectSource sends no body", async () => {
  reply(200, {}, "OK");
  await connectSource("github");
  assert.equal(calls[0]?.init?.body, undefined);
});

const channels = [
  { id: "C1", name: "general" },
  { id: "C2", name: "dev" },
];

const setupFailures = [
  ["not-a-channel", "not-a-channel"],
  ["disabled", "disabled"],
  ["rejected", "rejected"],
  ["no-credential", "rejected"],
  ["missing-scope", "restricted"],
  ["anything-else", "unreachable"],
] as const;

test("listSlackChannels resolves the channels and the truncated flag on a 200", async () => {
  reply(200, { channels, truncated: true }, "OK");
  assert.deepEqual(await listSlackChannels(), {
    ok: true,
    channels,
    truncated: true,
  });
});

test("listSlackChannels reads a missing truncated flag as false", async () => {
  reply(200, { channels }, "OK");
  assert.deepEqual(await listSlackChannels(), {
    ok: true,
    channels,
    truncated: false,
  });
});

test("listSlackChannels resolves an empty channel list as ok", async () => {
  reply(200, { channels: [], truncated: false }, "OK");
  assert.deepEqual(await listSlackChannels(), {
    ok: true,
    channels: [],
    truncated: false,
  });
});

for (const [error, reason] of setupFailures) {
  test(`listSlackChannels maps the ${error} error to ${reason}`, async () => {
    reply(400, { error }, "Bad Request");
    assert.deepEqual(await listSlackChannels(), { ok: false, reason });
  });
}

test("listSlackChannels maps a 200 with no channels to unreachable", async () => {
  reply(200, {}, "OK");
  assert.deepEqual(await listSlackChannels(), {
    ok: false,
    reason: "unreachable",
  });
});

test("listSlackChannels maps a 200 with an empty body to unreachable", async () => {
  reply(200, "", "OK");
  assert.deepEqual(await listSlackChannels(), {
    ok: false,
    reason: "unreachable",
  });
});

test("listSlackChannels ignores channels on a failure status", async () => {
  reply(500, { channels, error: "rejected" }, "Internal Server Error");
  assert.deepEqual(await listSlackChannels(), {
    ok: false,
    reason: "rejected",
  });
});

test("listSlackChannels maps a non-JSON failure body to unreachable", async () => {
  reply(502, "<html>", "Bad Gateway");
  assert.deepEqual(await listSlackChannels(), {
    ok: false,
    reason: "unreachable",
  });
});

test("listSlackChannels maps a network failure to unreachable", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
  assert.deepEqual(await listSlackChannels(), {
    ok: false,
    reason: "unreachable",
  });
});

test("resolveSlackChannel resolves the id and name on a 200", async () => {
  reply(200, { id: "C1", name: "general" }, "OK");
  assert.deepEqual(await resolveSlackChannel("#general"), {
    ok: true,
    id: "C1",
    name: "general",
  });
  assert.equal(calls[0]?.url, "/api/slack/channels/resolve");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ input: "#general" }));
});

for (const [error, reason] of setupFailures) {
  test(`resolveSlackChannel maps the ${error} error to ${reason}`, async () => {
    reply(400, { error }, "Bad Request");
    assert.deepEqual(await resolveSlackChannel("x"), { ok: false, reason });
  });
}

test("resolveSlackChannel maps a 200 with no name to unreachable", async () => {
  reply(200, { id: "C1" }, "OK");
  assert.deepEqual(await resolveSlackChannel("x"), {
    ok: false,
    reason: "unreachable",
  });
});

test("resolveSlackChannel maps a 200 with no id to unreachable", async () => {
  reply(200, { name: "general" }, "OK");
  assert.deepEqual(await resolveSlackChannel("x"), {
    ok: false,
    reason: "unreachable",
  });
});

test("resolveSlackChannel maps a 200 with an empty body to unreachable", async () => {
  reply(200, "", "OK");
  assert.deepEqual(await resolveSlackChannel("x"), {
    ok: false,
    reason: "unreachable",
  });
});

test("resolveSlackChannel ignores an id and name on a failure status", async () => {
  reply(404, { id: "C1", name: "general", error: "not-a-channel" }, "x");
  assert.deepEqual(await resolveSlackChannel("x"), {
    ok: false,
    reason: "not-a-channel",
  });
});

test("resolveSlackChannel maps a non-JSON failure body to unreachable", async () => {
  reply(502, "<html>", "Bad Gateway");
  assert.deepEqual(await resolveSlackChannel("x"), {
    ok: false,
    reason: "unreachable",
  });
});

test("resolveSlackChannel maps a network failure to unreachable", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
  assert.deepEqual(await resolveSlackChannel("x"), {
    ok: false,
    reason: "unreachable",
  });
});

test("saveSlackChannels resolves the saved channels on a 200", async () => {
  reply(200, { channels }, "OK");
  assert.deepEqual(await saveSlackChannels(channels), channels);
  assert.equal(calls[0]?.url, "/api/sources/slack/channels");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ channels }));
});

test("saveSlackChannels resolves the server's list, not the sent one", async () => {
  reply(200, { channels: [channels[0]] }, "OK");
  assert.deepEqual(await saveSlackChannels(channels), [channels[0]]);
});

for (const [status, statusText] of [
  [400, "Bad Request"],
  [500, "Internal Server Error"],
] as const) {
  test(`saveSlackChannels resolves null on a ${status}`, async () => {
    reply(status, { channels }, statusText);
    assert.equal(await saveSlackChannels(channels), null);
  });
}

test("saveSlackChannels resolves null on a 200 with a non-JSON body", async () => {
  reply(200, "<html>", "OK");
  assert.equal(await saveSlackChannels(channels), null);
});

test("saveSlackChannels resolves null on a 200 with an empty body", async () => {
  reply(200, "", "OK");
  assert.equal(await saveSlackChannels(channels), null);
});

test("saveSlackChannels resolves null on a network failure", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
  assert.equal(await saveSlackChannels(channels), null);
});
