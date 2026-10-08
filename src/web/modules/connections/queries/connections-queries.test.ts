import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import {
  getLinearFilters,
  getLinearOptions,
  getLinearStateMap,
  listCalendars,
  listSlackChannels,
  previewLinearFilters,
  putCalendarSettings,
  resolveSlackChannel,
  saveLinearFilters,
  saveLinearStateMap,
  saveSlackChannels,
} from "./connections-api.js";
import {
  checkCalendarAccessMutationOptions,
  connectionsKeys,
  linearFiltersQueryOptions,
  linearOptionsQueryOptions,
  linearPreviewQueryOptions,
  listCalendarsMutationOptions,
  refreshLinearFilters,
  resolveSlackChannelMutationOptions,
  saveCalendarSettingsMutationOptions,
  saveLinearFiltersMutationOptions,
  saveLinearStateMapMutationOptions,
  saveSlackChannelsMutationOptions,
  linearStateMapQueryOptions,
  linearWorkflowQueryOptions,
  savedSlackChannelsQueryOptions,
  slackChannelsQueryOptions,
} from "./connections-queries.js";
import { calendarStatusKeys } from "@/queries/calendar-status-queries";

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
  assert.deepEqual(connectionsKeys.linearStateMap, [
    "settings",
    "linear-state-map",
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

test("linearFiltersQueryOptions requests the Linear filters", async () => {
  const options = linearFiltersQueryOptions();
  assert.deepEqual(options.queryKey, ["connections", "linear", "filters"]);
  assert.equal(options.refetchOnReconnect, false);
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

test("linearStateMapQueryOptions keeps the settings key and requests the state map", async () => {
  const options = linearStateMapQueryOptions();
  assert.deepEqual(options.queryKey, ["settings", "linear-state-map"]);
  reply(200, { stateMap: { todo: "s1" } });
  assert.deepEqual(await newClient().fetchQuery(options), { todo: "s1" });
  assert.equal(calls[0]?.url, "/api/config/linear-state-map");
});

test("linearWorkflowQueryOptions requests the Linear workflow", async () => {
  const options = linearWorkflowQueryOptions();
  assert.deepEqual(options.queryKey, ["connections", "linear", "workflow"]);
  reply(200, { viewer: {}, teams: [] });
  await newClient().fetchQuery(options);
  assert.equal(calls[0]?.url, "/api/sources/linear/workflow");
});

test("a loaded Linear workflow is read once per page load", async () => {
  const client = newClient();
  reply(200, { viewer: {}, teams: [] });
  await client.fetchQuery(linearWorkflowQueryOptions());
  await client.fetchQuery(linearWorkflowQueryOptions());
  assert.equal(calls.length, 1);
});

test("a failed Linear workflow read is retried on the next read", async () => {
  const client = newClient();
  reply(502, { error: "Linear is down" });
  const first = await client.fetchQuery(linearWorkflowQueryOptions());
  assert.equal(first.ok, false);
  reply(200, { viewer: {}, teams: [] });
  await client.fetchQuery(linearWorkflowQueryOptions());
  assert.equal(calls.length, 2);
});

test("savedSlackChannelsQueryOptions requests the saved Slack channels", async () => {
  const options = savedSlackChannelsQueryOptions();
  assert.deepEqual(options.queryKey, [
    "connections",
    "slack",
    "saved-channels",
  ]);
  assert.equal(options.staleTime, 0);
  assert.equal(options.refetchOnReconnect, false);
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

const stateMap = { team1: { todo: "s1" } };

test("getLinearStateMap throws on a failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    getLinearStateMap(),
    new Error("getLinearStateMap failed: 500 Internal Server Error"),
  );
});

test("saveLinearStateMap resolves ok on a 200", async () => {
  reply(200, {}, "OK");
  assert.deepEqual(await saveLinearStateMap(stateMap), { ok: true });
  assert.equal(calls[0]?.url, "/api/config/linear-state-map");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ stateMap }));
});

test("saveLinearStateMap carries the server error on a 400", async () => {
  reply(400, { error: "unknown state" }, "Bad Request");
  assert.deepEqual(await saveLinearStateMap(stateMap), {
    ok: false,
    error: "unknown state",
  });
});

test("saveLinearStateMap falls back to its copy on a 400 with no error", async () => {
  reply(400, {}, "Bad Request");
  assert.deepEqual(await saveLinearStateMap(stateMap), {
    ok: false,
    error: "Couldn't save the state map. Try again.",
  });
});

test("saveLinearStateMap resolves unreachable on a network failure", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
  assert.deepEqual(await saveLinearStateMap(stateMap), {
    ok: false,
    error: "Could not reach Dispatch. Try again.",
  });
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

test("connectionsKeys.linearPreview keys on the draft filters", () => {
  assert.deepEqual(connectionsKeys.linearPreview(filters), [
    "connections",
    "linear",
    "preview",
    filters,
  ]);
});

test("linearPreviewQueryOptions posts the draft and always re-reads", async () => {
  const options = linearPreviewQueryOptions(filters);
  assert.equal(options.staleTime, 0);
  reply(200, { count: 4, more: false });
  assert.deepEqual(await newClient().fetchQuery(options), {
    count: 4,
    more: false,
  });
  assert.equal(calls[0]?.url, "/api/sources/linear/preview");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ filters }));
});

test("previewLinearFilters resolves null on a failure status", async () => {
  reply(502, {});
  assert.equal(await previewLinearFilters(filters), null);
});

test("previewLinearFilters resolves null on a network failure", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("network down"));
  assert.equal(await previewLinearFilters(filters), null);
});

test("refreshLinearFilters marks the filters, every option list and the preview stale", async () => {
  const client = newClient();
  const keys = [
    connectionsKeys.linearFilters,
    connectionsKeys.linearOptions("assignees"),
    connectionsKeys.linearOptions("teams"),
    connectionsKeys.linearWorkflow,
    connectionsKeys.linearPreview(filters),
  ];
  for (const key of keys) client.setQueryData(key, {});
  await refreshLinearFilters(client);
  assert.deepEqual(
    keys.map((key) => client.getQueryState(key)?.isInvalidated),
    [true, true, true, false, true],
  );
});

test("an accepted filters save writes the draft into the cached filters", async () => {
  const client = newClient();
  client.setQueryData(connectionsKeys.linearFilters, {
    filters,
    capabilities: { dimensions: [] },
  });
  const draft = { ...filters, currentCycle: true };
  reply(200, {});
  await new MutationObserver(
    client,
    saveLinearFiltersMutationOptions(client),
  ).mutate(draft);
  assert.deepEqual(client.getQueryData(connectionsKeys.linearFilters), {
    filters: draft,
    capabilities: { dimensions: [] },
  });
});

test("a refused filters save leaves the cached filters alone", async () => {
  const client = newClient();
  const cached = { filters, capabilities: { dimensions: [] } };
  client.setQueryData(connectionsKeys.linearFilters, cached);
  reply(400, { error: "Bad filters" });
  const result = await new MutationObserver(
    client,
    saveLinearFiltersMutationOptions(client),
  ).mutate({ ...filters, currentCycle: true });
  assert.deepEqual(result, { ok: false, error: "Bad filters" });
  assert.deepEqual(client.getQueryData(connectionsKeys.linearFilters), cached);
});

test("a failed filters save rejects and leaves the cache alone", async () => {
  const client = newClient();
  const cached = { filters, capabilities: { dimensions: [] } };
  client.setQueryData(connectionsKeys.linearFilters, cached);
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    new MutationObserver(
      client,
      saveLinearFiltersMutationOptions(client),
    ).mutate(filters),
  );
  assert.deepEqual(client.getQueryData(connectionsKeys.linearFilters), cached);
});

test("an accepted state map save writes the map into the cache", async () => {
  const client = newClient();
  client.setQueryData(connectionsKeys.linearStateMap, {});
  reply(200, {});
  await new MutationObserver(
    client,
    saveLinearStateMapMutationOptions(client),
  ).mutate({ t1: { todo: "s1" } });
  assert.deepEqual(client.getQueryData(connectionsKeys.linearStateMap), {
    t1: { todo: "s1" },
  });
});

test("a refused state map save leaves the cached map alone", async () => {
  const client = newClient();
  client.setQueryData(connectionsKeys.linearStateMap, {});
  reply(400, { error: "Bad map" });
  const result = await new MutationObserver(
    client,
    saveLinearStateMapMutationOptions(client),
  ).mutate({ t1: { todo: "s1" } });
  assert.deepEqual(result, { ok: false, error: "Bad map" });
  assert.deepEqual(client.getQueryData(connectionsKeys.linearStateMap), {});
});

test("a saved channel list is written into the cached saved channels", async () => {
  const client = newClient();
  client.setQueryData(connectionsKeys.savedSlackChannels, []);
  reply(200, { channels: [{ id: "C1", name: "general" }] });
  await new MutationObserver(
    client,
    saveSlackChannelsMutationOptions(client),
  ).mutate([{ id: "C1", name: "general" }]);
  assert.deepEqual(client.getQueryData(connectionsKeys.savedSlackChannels), [
    { id: "C1", name: "general" },
  ]);
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ channels: [{ id: "C1", name: "general" }] }),
  );
});

test("a failed channel save leaves the cached saved channels alone", async () => {
  const client = newClient();
  client.setQueryData(connectionsKeys.savedSlackChannels, []);
  reply(500, {});
  const result = await new MutationObserver(
    client,
    saveSlackChannelsMutationOptions(client),
  ).mutate([{ id: "C1", name: "general" }]);
  assert.equal(result, null);
  assert.deepEqual(client.getQueryData(connectionsKeys.savedSlackChannels), []);
});

test("the resolve mutation resolves a pasted channel and a typed refusal", async () => {
  reply(200, { id: "C1", name: "general" });
  assert.deepEqual(await resolveSlackChannelMutationOptions.mutationFn("C1"), {
    ok: true,
    id: "C1",
    name: "general",
  });
  reply(404, { error: "not-a-channel" });
  assert.deepEqual(await resolveSlackChannelMutationOptions.mutationFn("x"), {
    ok: false,
    reason: "not-a-channel",
  });
});

test("the list calendars mutation lists this Mac's calendars", async () => {
  reply(200, { calendars: [{ title: "Work" }] });
  assert.deepEqual(await listCalendarsMutationOptions.mutationFn(), {
    ok: true,
    value: [{ title: "Work" }],
  });
});

test("an accepted calendar save writes the status into the shared calendar status", async () => {
  const client = newClient();
  client.setQueryData(calendarStatusKeys.status, { enabled: false });
  reply(200, { enabled: true });
  await new MutationObserver(
    client,
    saveCalendarSettingsMutationOptions(client),
  ).mutate({ enabled: true });
  assert.deepEqual(client.getQueryData(calendarStatusKeys.status), {
    enabled: true,
  });
});

test("a refused calendar save leaves the shared calendar status alone", async () => {
  const client = newClient();
  const before = { enabled: false, mode: "macos", calendars: [] };
  client.setQueryData(calendarStatusKeys.status, before);
  reply(409, { error: "denied" });
  const result = await new MutationObserver(
    client,
    saveCalendarSettingsMutationOptions(client),
  ).mutate({ enabled: true });
  assert.deepEqual(result, { ok: false, error: "denied" });
  assert.deepEqual(client.getQueryData(calendarStatusKeys.status), before);
});

test("a calendar access check posts and writes the answered status into the cache", async () => {
  const client = newClient();
  client.setQueryData(calendarStatusKeys.status, { permission: "not-asked" });
  reply(200, { permission: "granted" });
  await new MutationObserver(
    client,
    checkCalendarAccessMutationOptions(client),
  ).mutate();
  assert.equal(calls[0]?.url, "/api/calendar/access/check");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(client.getQueryData(calendarStatusKeys.status), {
    permission: "granted",
  });
});

test("an optimistic calendar save shows the calendars at once and a 409 restores the snapshot", async () => {
  const client = newClient();
  const before = { enabled: false, mode: "macos", calendars: ["Home"] };
  client.setQueryData(calendarStatusKeys.status, before);
  let seen: unknown;
  globalThis.fetch = () => {
    seen = client.getQueryData(calendarStatusKeys.status);
    return Promise.resolve(
      new Response(JSON.stringify({ error: "denied" }), { status: 409 }),
    );
  };
  const result = await new MutationObserver(
    client,
    saveCalendarSettingsMutationOptions(client),
  ).mutate({ enabled: true, calendars: ["Work"] });
  assert.deepEqual(seen, { ...before, calendars: ["Work"] });
  assert.deepEqual(result, { ok: false, error: "denied" });
  assert.deepEqual(client.getQueryData(calendarStatusKeys.status), before);
});

test("a refused calendar save keeps a permission an access check wrote after the snapshot", async () => {
  const client = newClient();
  client.setQueryData(calendarStatusKeys.status, {
    enabled: false,
    mode: "macos",
    calendars: ["Home"],
    permission: "not-asked",
  });
  globalThis.fetch = () => {
    client.setQueryData(calendarStatusKeys.status, {
      ...client.getQueryData<object>(calendarStatusKeys.status),
      permission: "granted",
    });
    return Promise.resolve(
      new Response(JSON.stringify({ error: "denied" }), { status: 409 }),
    );
  };
  await new MutationObserver(
    client,
    saveCalendarSettingsMutationOptions(client),
  ).mutate({ calendars: ["Work"] });
  assert.deepEqual(client.getQueryData(calendarStatusKeys.status), {
    enabled: false,
    mode: "macos",
    calendars: ["Home"],
    permission: "granted",
  });
});

test("a thrown network error restores the calendar status snapshot", async () => {
  const client = newClient();
  const before = { enabled: false, mode: "macos", calendars: ["Home"] };
  client.setQueryData(calendarStatusKeys.status, before);
  globalThis.fetch = () => Promise.reject(new TypeError("network down"));
  await assert.rejects(
    new MutationObserver(
      client,
      saveCalendarSettingsMutationOptions(client),
    ).mutate({ calendars: ["Work"] }),
  );
  assert.deepEqual(client.getQueryData(calendarStatusKeys.status), before);
});

test("listCalendars resolves the calendars on a 200", async () => {
  reply(200, { calendars: [{ id: "c1" }] });
  assert.deepEqual(await listCalendars(), {
    ok: true,
    value: [{ id: "c1" }],
  });
  assert.equal(calls[0]?.url, "/api/calendar/calendars");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, undefined);
});

test("listCalendars carries the error code on a 409", async () => {
  reply(409, { error: "denied" });
  assert.deepEqual(await listCalendars(), { ok: false, error: "denied" });
});

test("listCalendars falls back to failed on a 409 with no code", async () => {
  reply(409, "");
  assert.deepEqual(await listCalendars(), { ok: false, error: "failed" });
});

test("listCalendars throws on any other failure status", async () => {
  reply(500, {});
  await assert.rejects(
    listCalendars(),
    new Error("calendar request failed: 500"),
  );
});

test("putCalendarSettings resolves the saved status on a 200", async () => {
  reply(200, { enabled: true });
  assert.deepEqual(await putCalendarSettings({ enabled: true }), {
    ok: true,
    value: { enabled: true },
  });
  assert.equal(calls[0]?.url, "/api/calendar/settings");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ enabled: true }));
});

test("putCalendarSettings carries the error code on a 409", async () => {
  reply(409, { error: "denied" });
  assert.deepEqual(await putCalendarSettings({ enabled: true }), {
    ok: false,
    error: "denied",
  });
});

test("putCalendarSettings throws on any other failure status", async () => {
  reply(400, {});
  await assert.rejects(
    putCalendarSettings({ enabled: true }),
    new Error("calendar request failed: 400"),
  );
});
