import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import {
  disablePush,
  saveClaudeArgs,
  saveCleanupDelay,
  saveProfile,
  saveTerminalAppearance,
} from "./settings-api.js";
import { isPushSupported, refreshPushSubscription } from "@/queries/push-api";
import {
  claudeArgsQueryOptions,
  cleanupDelayQueryOptions,
  disablePushMutationOptions,
  disableRemoteMutationOptions,
  enablePushMutationOptions,
  enableRemoteMutationOptions,
  profileQueryOptions,
  pushSubscriptionQueryOptions,
  readPushEnvironment,
  saveClaudeArgsMutationOptions,
  saveCleanupDelayMutationOptions,
  saveProfileMutationOptions,
  saveTerminalAppearanceMutationOptions,
  settingsKeys,
  terminalAppearanceQueryOptions,
} from "./settings-queries.js";

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

const appearance = {
  background: "term-bg",
  foreground: "term-fg",
  cursor: "term-cursor",
  fontFamily: "Menlo",
  fontSize: 13,
};

test("settingsKeys has the documented shape", () => {
  assert.deepEqual(settingsKeys.all, ["settings"]);
  assert.deepEqual(settingsKeys.cleanupDelay, ["settings", "cleanup-delay"]);
  assert.deepEqual(settingsKeys.terminal, ["settings", "terminal"]);
  assert.deepEqual(settingsKeys.claudeArgs, ["settings", "claude-args"]);
  assert.deepEqual(settingsKeys.linearStateMap, [
    "settings",
    "linear-state-map",
  ]);
  assert.deepEqual(settingsKeys.profile, ["settings", "profile"]);
  assert.deepEqual(settingsKeys.archiveRetention, [
    "settings",
    "archive-retention",
  ]);
  assert.deepEqual(settingsKeys.pushSubscription, [
    "settings",
    "push-subscription",
  ]);
});

const reads = [
  {
    name: "cleanupDelayQueryOptions",
    key: cleanupDelayQueryOptions().queryKey,
    run: () => newClient().fetchQuery(cleanupDelayQueryOptions()),
    expectedKey: ["settings", "cleanup-delay"],
    url: "/api/config/cleanup-delay",
    body: { cleanupDelayDays: 7 },
    data: { cleanupDelayDays: 7 },
  },
  {
    name: "terminalAppearanceQueryOptions",
    key: terminalAppearanceQueryOptions().queryKey,
    run: () => newClient().fetchQuery(terminalAppearanceQueryOptions()),
    expectedKey: ["settings", "terminal"],
    url: "/api/config/terminal",
    body: appearance,
    data: appearance,
  },
  {
    name: "claudeArgsQueryOptions",
    key: claudeArgsQueryOptions().queryKey,
    run: () => newClient().fetchQuery(claudeArgsQueryOptions()),
    expectedKey: ["settings", "claude-args"],
    url: "/api/config/claude-args",
    body: { claudeArgs: "claude-arg" },
    data: { claudeArgs: "claude-arg" },
  },
  {
    name: "profileQueryOptions",
    key: profileQueryOptions().queryKey,
    run: () => newClient().fetchQuery(profileQueryOptions()),
    expectedKey: ["settings", "profile"],
    url: "/api/config/profile",
    body: { name: "Ada" },
    data: { name: "Ada" },
  },
];

for (const read of reads) {
  test(`${read.name} has its key and requests ${read.url}`, async () => {
    assert.deepEqual(read.key, read.expectedKey);
    reply(200, read.body);
    assert.deepEqual(await read.run(), read.data);
    assert.equal(calls[0]?.url, read.url);
  });
}

const savers = [
  {
    name: "saveCleanupDelay",
    call: () => saveCleanupDelay(7),
    url: "/api/config/cleanup-delay",
    body: { cleanupDelayDays: 7 },
    fallback: "Couldn't save cleanup delay.",
  },
  {
    name: "saveTerminalAppearance",
    call: () => saveTerminalAppearance(appearance),
    url: "/api/config/terminal",
    body: appearance,
    fallback: "invalid terminal appearance",
  },
  {
    name: "saveClaudeArgs",
    call: () => saveClaudeArgs("claude-arg"),
    url: "/api/config/claude-args",
    body: { claudeArgs: "claude-arg" },
    fallback: "Couldn't save Claude arguments.",
  },
  {
    name: "saveProfile",
    call: () => saveProfile({ name: "Ada" }),
    url: "/api/config/profile",
    body: { name: "Ada" },
    fallback: "Invalid profile",
  },
];

for (const saver of savers) {
  if (saver.name !== "saveProfile") {
    test(`${saver.name} resolves ok on a 200`, async () => {
      reply(200, {}, "OK");
      assert.deepEqual(await saver.call(), { ok: true });
      assert.equal(calls[0]?.url, saver.url);
      assert.equal(calls[0]?.init?.method, "PUT");
      assert.equal(calls[0]?.init?.body, JSON.stringify(saver.body));
    });
  }

  test(`${saver.name} carries the validation error on a 400`, async () => {
    reply(400, { error: "field x is bad" }, "Bad Request");
    assert.deepEqual(await saver.call(), {
      ok: false,
      error: "field x is bad",
    });
  });

  test(`${saver.name} falls back to its copy on a 400 with no error`, async () => {
    reply(400, {}, "Bad Request");
    assert.deepEqual(await saver.call(), { ok: false, error: saver.fallback });
  });

  test(`${saver.name} throws on any other failure status`, async () => {
    reply(500, {}, "Internal Server Error");
    await assert.rejects(
      saver.call(),
      new Error(`${saver.name} failed: 500 Internal Server Error`),
    );
  });
}

test("saveProfile resolves the stored profile on a 200", async () => {
  reply(200, { name: "Ada", handles: [] }, "OK");
  assert.deepEqual(await saveProfile({ name: " Ada " }), {
    ok: true,
    profile: { name: "Ada", handles: [] },
  });
  assert.equal(calls[0]?.url, "/api/config/profile");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ name: " Ada " }));
});

const pushGlobals = ["window", "navigator", "localStorage", "Notification"];
const savedGlobals = new Map<string, PropertyDescriptor | undefined>();

function stubGlobals(values: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!savedGlobals.has(name)) {
      savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    }
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  }
}

afterEach(() => {
  for (const name of pushGlobals) {
    if (!savedGlobals.has(name)) continue;
    const saved = savedGlobals.get(name);
    if (saved) Object.defineProperty(globalThis, name, saved);
    else delete (globalThis as Record<string, unknown>)[name];
  }
  savedGlobals.clear();
});

test("isPushSupported is false when the navigator has no serviceWorker", () => {
  stubGlobals({
    window: { Notification: {}, PushManager: {} },
    navigator: {},
  });
  assert.equal(isPushSupported(), false);
});

test("disablePush unsubscribes and posts the endpoint when a subscription exists", async () => {
  let unsubscribed = false;
  const removed: string[] = [];
  stubGlobals({
    window: { Notification: {}, PushManager: {} },
    navigator: {
      serviceWorker: {
        getRegistration: () =>
          Promise.resolve({
            pushManager: {
              getSubscription: () =>
                Promise.resolve({
                  endpoint: "https://push.example/e1",
                  unsubscribe: () => {
                    unsubscribed = true;
                    return Promise.resolve(true);
                  },
                }),
            },
          }),
      },
    },
    localStorage: { removeItem: (key: string) => removed.push(key) },
  });
  reply(200, {});
  assert.equal(await disablePush(), true);
  assert.equal(unsubscribed, true);
  assert.equal(calls[0]?.url, "/api/push/unsubscribe");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ endpoint: "https://push.example/e1" }),
  );
  assert.deepEqual(removed, ["dsp.push"]);
});

test("refreshPushSubscription does nothing when the marker is off", async () => {
  let registered = false;
  stubGlobals({
    window: { Notification: {}, PushManager: {} },
    navigator: {
      serviceWorker: {
        register: () => {
          registered = true;
          return Promise.resolve({});
        },
      },
    },
    localStorage: { getItem: () => null },
  });
  reply(200, {});
  await refreshPushSubscription();
  assert.equal(registered, false);
  assert.equal(calls.length, 0);
});

const writes = [
  {
    name: "cleanup delay",
    key: settingsKeys.cleanupDelay,
    before: { cleanupDelayDays: 3 },
    after: { cleanupDelayDays: 7 },
    run: (client: QueryClient) =>
      new MutationObserver(
        client,
        saveCleanupDelayMutationOptions(client),
      ).mutate(7),
  },
  {
    name: "Claude arguments",
    key: settingsKeys.claudeArgs,
    before: { claudeArgs: "old-arg" },
    after: { claudeArgs: "new-arg" },
    run: (client: QueryClient) =>
      new MutationObserver(
        client,
        saveClaudeArgsMutationOptions(client),
      ).mutate("new-arg"),
  },
  {
    name: "terminal appearance",
    key: settingsKeys.terminal,
    before: { ...appearance, fontSize: 11 },
    after: appearance,
    run: (client: QueryClient) =>
      new MutationObserver(
        client,
        saveTerminalAppearanceMutationOptions(client),
      ).mutate(appearance),
  },
];

for (const write of writes) {
  test(`an accepted ${write.name} save writes the saved value into the cache`, async () => {
    const client = newClient();
    client.setQueryData(write.key, write.before);
    reply(200, {});
    assert.deepEqual(await write.run(client), { ok: true });
    assert.deepEqual(client.getQueryData(write.key), write.after);
  });

  test(`a refused ${write.name} save resolves the message and leaves the cache alone`, async () => {
    const client = newClient();
    client.setQueryData(write.key, write.before);
    reply(400, { error: "field x is bad" }, "Bad Request");
    assert.deepEqual(await write.run(client), {
      ok: false,
      error: "field x is bad",
    });
    assert.deepEqual(client.getQueryData(write.key), write.before);
  });

  test(`a failed ${write.name} save rejects and leaves the cache alone`, async () => {
    const client = newClient();
    client.setQueryData(write.key, write.before);
    reply(500, {}, "Internal Server Error");
    await assert.rejects(write.run(client));
    assert.deepEqual(client.getQueryData(write.key), write.before);
  });
}

test("an accepted profile save writes the stored profile into the cache", async () => {
  const client = newClient();
  client.setQueryData(settingsKeys.profile, { name: "Old" });
  reply(200, { name: "Ada", handles: ["ada"] });
  const result = await new MutationObserver(
    client,
    saveProfileMutationOptions(client),
  ).mutate({ name: " Ada " });
  assert.deepEqual(result, {
    ok: true,
    profile: { name: "Ada", handles: ["ada"] },
  });
  assert.deepEqual(client.getQueryData(settingsKeys.profile), {
    name: "Ada",
    handles: ["ada"],
  });
});

test("a refused profile save resolves the message and leaves the cache alone", async () => {
  const client = newClient();
  client.setQueryData(settingsKeys.profile, { name: "Old" });
  reply(400, { error: "name is too long" }, "Bad Request");
  const result = await new MutationObserver(
    client,
    saveProfileMutationOptions(client),
  ).mutate({ name: "x" });
  assert.deepEqual(result, { ok: false, error: "name is too long" });
  assert.deepEqual(client.getQueryData(settingsKeys.profile), { name: "Old" });
});

test("a failed profile save rejects and leaves the cache alone", async () => {
  const client = newClient();
  client.setQueryData(settingsKeys.profile, { name: "Old" });
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    new MutationObserver(client, saveProfileMutationOptions(client)).mutate({
      name: "x",
    }),
    new Error("saveProfile failed: 500 Internal Server Error"),
  );
  assert.deepEqual(client.getQueryData(settingsKeys.profile), { name: "Old" });
});

test("the remote mutations post to the enable and disable routes", async () => {
  const client = newClient();
  reply(200, {});
  await new MutationObserver(client, enableRemoteMutationOptions).mutate();
  await new MutationObserver(client, disableRemoteMutationOptions).mutate();
  assert.deepEqual(
    calls.map((call) => [call.url, call.init?.method]),
    [
      ["/api/remote/enable", "POST"],
      ["/api/remote/disable", "POST"],
    ],
  );
});

test("a failed remote enable rejects with the status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    new MutationObserver(newClient(), enableRemoteMutationOptions).mutate(),
    new Error("enableRemote failed: 500 Internal Server Error"),
  );
});

function stubPushBrowser(subscribed: boolean): void {
  stubGlobals({
    window: { Notification: {}, PushManager: {} },
    navigator: {
      userAgent: "Mozilla/5.0",
      serviceWorker: {
        getRegistration: () =>
          Promise.resolve({
            pushManager: {
              getSubscription: () =>
                Promise.resolve(
                  subscribed
                    ? {
                        endpoint: "https://push.example/e1",
                        unsubscribe: () => Promise.resolve(true),
                      }
                    : null,
                ),
            },
          }),
      },
    },
    localStorage: { removeItem: () => undefined },
  });
}

test("pushSubscriptionQueryOptions answers whether a subscription exists", async () => {
  const options = pushSubscriptionQueryOptions();
  assert.deepEqual(options.queryKey, ["settings", "push-subscription"]);
  stubPushBrowser(true);
  assert.equal(await newClient().fetchQuery(options), true);
  stubPushBrowser(false);
  assert.equal(await newClient().fetchQuery(options), false);
});

test("pushSubscriptionQueryOptions answers false when push is unsupported", async () => {
  stubGlobals({ window: {}, navigator: {} });
  assert.equal(
    await newClient().fetchQuery(pushSubscriptionQueryOptions()),
    false,
  );
});

test("a disable unsubscribes, posts the endpoint and re-reads the subscription", async () => {
  const client = newClient();
  stubPushBrowser(true);
  await client.fetchQuery(pushSubscriptionQueryOptions());
  reply(200, {});
  assert.equal(
    await new MutationObserver(
      client,
      disablePushMutationOptions(client),
    ).mutate(),
    true,
  );
  assert.equal(calls[0]?.url, "/api/push/unsubscribe");
  assert.equal(client.getQueryData(settingsKeys.pushSubscription), true);
});

test("an enable that fails resolves a typed failure and still re-reads the subscription", async () => {
  const client = newClient();
  stubPushBrowser(true);
  await client.fetchQuery(pushSubscriptionQueryOptions());
  assert.equal(client.getQueryData(settingsKeys.pushSubscription), true);
  stubPushBrowser(false);
  const result = await new MutationObserver(
    client,
    enablePushMutationOptions(client),
  ).mutate();
  assert.deepEqual(result, { ok: false, error: "generic" });
  assert.equal(client.getQueryData(settingsKeys.pushSubscription), false);
});

test("readPushEnvironment reports support and the iOS check", () => {
  stubGlobals({
    window: { Notification: {}, PushManager: {} },
    navigator: {
      userAgent: "Mozilla/5.0 (iPhone)",
      serviceWorker: {},
    },
  });
  assert.deepEqual(readPushEnvironment(), { supported: true, ios: true });
});
