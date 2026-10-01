import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  disablePush,
  isPushSupported,
  refreshPushSubscription,
  saveArchiveRetention,
  saveClaudeArgs,
  saveCleanupDelay,
  saveProfile,
  saveTerminalAppearance,
} from "./settings-api.js";
import {
  archiveRetentionQueryOptions,
  claudeArgsQueryOptions,
  cleanupDelayQueryOptions,
  linearStateMapQueryOptions,
  profileQueryOptions,
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
    name: "linearStateMapQueryOptions",
    key: linearStateMapQueryOptions().queryKey,
    run: () => newClient().fetchQuery(linearStateMapQueryOptions()),
    expectedKey: ["settings", "linear-state-map"],
    url: "/api/config/linear-state-map",
    body: { stateMap: { todo: "s1" } },
    data: { todo: "s1" },
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
  {
    name: "archiveRetentionQueryOptions",
    key: archiveRetentionQueryOptions().queryKey,
    run: () => newClient().fetchQuery(archiveRetentionQueryOptions()),
    expectedKey: ["settings", "archive-retention"],
    url: "/api/config/archive-retention",
    body: { archiveRetentionDays: 30 },
    data: { archiveRetentionDays: 30 },
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
    name: "saveArchiveRetention",
    call: () => saveArchiveRetention(30),
    url: "/api/config/archive-retention",
    body: { archiveRetentionDays: 30 },
    fallback: "Couldn't save archive retention.",
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
