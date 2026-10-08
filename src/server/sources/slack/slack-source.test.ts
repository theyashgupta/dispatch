import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";
import type {
  SlackChannel,
  SlackMode,
  SourceCursor,
} from "../../../shared/types.js";

isolateEnv();
const { SlackSource } = await import("./slack.source.js");
const { RateLimited } = await import("../ticket.source.js");

const TOKEN = "xoxp-g6-fake-user";
const ME = "U0G6USER";
const NOW = 1_700_100_000_000;

afterEach(() => mock.restoreAll());

type Answer = (params: URLSearchParams) => {
  status?: number;
  body: Record<string, unknown>;
};

interface Call {
  method: string;
  params: URLSearchParams;
  url: string;
  auth: string | null;
}

function stubSlack(handlers: Record<string, Answer>): Call[] {
  const calls: Call[] = [];
  mock.method(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      const method = url.pathname.split("/").pop() ?? "";
      calls.push({
        method,
        params: url.searchParams,
        url: url.toString(),
        auth: new Headers(init?.headers).get("authorization"),
      });
      const handler = handlers[method];
      const { status = 200, body } = handler
        ? handler(url.searchParams)
        : { body: { ok: false, error: "unknown_method" } };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  );
  return calls;
}

const auth: Answer = () => ({
  body: {
    ok: true,
    url: "https://acme.slack.com/",
    team: "Acme",
    user: "g6-tester",
    user_id: ME,
  },
});

const users: Answer = (p) => {
  const id = p.get("user") ?? "";
  const names: Record<string, string> = {
    U0G6ANA: "ana",
    U0G6BEN: "ben",
    [ME]: "g6-tester",
  };
  return names[id]
    ? {
        body: {
          ok: true,
          user: { name: names[id], profile: { display_name: names[id] } },
        },
      }
    : { body: { ok: false, error: "user_not_found" } };
};

const noDms: Answer = () => ({
  body: { ok: true, channels: [], response_metadata: { next_cursor: "" } },
});

function source(
  channels: SlackChannel[],
  credential: { token: string } | null = { token: TOKEN },
) {
  return new SlackSource(
    () =>
      Promise.resolve(
        credential ? { token: credential.token, via: "vault" as const } : null,
      ),
    () => channels,
    120_000,
    () => NOW,
  );
}

const ENG = { id: "C0G6ENG", name: "eng-platform" };
const GEN = { id: "C0G6GEN", name: "general" };

test("a full poll turns mentions and DMs into items and drops everything else", async () => {
  const history: Record<string, unknown[]> = {
    C0G6ENG: [
      { ts: "1700000010.000100", user: "U0G6ANA", text: `hey <@${ME}> look` },
      {
        ts: "1700000011.000100",
        user: "U0G6BEN",
        text: `<@${ME}|g6-tester> ping`,
      },
      { ts: "1700000012.000100", user: "U0G6ANA", text: "just chatter" },
      { ts: "1700000013.000100", user: ME, text: `<@${ME}> note to self` },
      { ts: "1700000014.000100", bot_id: "B1", text: `<@${ME}> bot` },
      {
        ts: "1700000015.000100",
        user: "U0G6ANA",
        subtype: "channel_join",
        text: `<@${ME}> joined`,
      },
      {
        ts: "1700000016.000100",
        user: "U0G6ANA",
        subtype: "thread_broadcast",
        text: `<@${ME}> also`,
      },
      {
        ts: "1700000017.000100",
        user: "U0G6BEN",
        subtype: "file_share",
        text: `<@${ME}> file`,
        thread_ts: "1700000017.000100",
        reply_count: 2,
      },
    ],
    D0G6DM1: [{ ts: "1700000020.000100", user: "U0G6ANA", text: "direct ask" }],
    G0G6MP1: [
      { ts: "1700000021.000100", user: "U0G6BEN", text: "group ask" },
      { ts: "1700000022.000100", user: ME, text: "my reply" },
    ],
  };
  const calls = stubSlack({
    "auth.test": auth,
    "users.info": users,
    "users.conversations": () => ({
      body: {
        ok: true,
        channels: [
          { id: "D0G6DM1", is_im: true, user: "U0G6ANA" },
          { id: "G0G6MP1", is_mpim: true, name: "mpdm-g6-tester-ben-1" },
        ],
        response_metadata: { next_cursor: "" },
      },
    }),
    "conversations.history": (p) => ({
      body: { ok: true, messages: history[p.get("channel") ?? ""] ?? [] },
    }),
  });
  const result = await source([ENG]).fetch({ cursors: {} });
  assert.deepEqual(
    result.items.map((i) => [i.id, i.type, i.title]),
    [
      [
        "slack:C0G6ENG:1700000010.000100",
        "mention",
        "ana in #eng-platform: hey @g6-tester look",
      ],
      [
        "slack:C0G6ENG:1700000011.000100",
        "mention",
        "ben in #eng-platform: @g6-tester ping",
      ],
      [
        "slack:C0G6ENG:1700000016.000100",
        "mention",
        "ana in #eng-platform: @g6-tester also",
      ],
      [
        "slack:C0G6ENG:1700000017.000100",
        "mention",
        "ben in #eng-platform: @g6-tester file",
      ],
      ["slack:D0G6DM1:1700000020.000100", "dm", "ana in DM: direct ask"],
      ["slack:G0G6MP1:1700000021.000100", "dm", "ben in group DM: group ask"],
    ],
  );
  const threaded = result.items.find((i) => i.id.endsWith("17.000100"));
  assert.equal(
    threaded?.url,
    "https://acme.slack.com/archives/C0G6ENG/p1700000017000100",
  );
  assert.equal(threaded?.meta.threadTs, "1700000017.000100");
  assert.equal(threaded?.meta.replyCount, "2");
  assert.deepEqual(result.issues, []);
  assert.equal(result.truncated, false);
  const polledAt = new Date(NOW).toISOString();
  assert.deepEqual(result.cursors, {
    C0G6ENG: { cursor: "1700000017.000100", polledAt },
    D0G6DM1: { cursor: "1700000020.000100", polledAt },
    G0G6MP1: { cursor: "1700000022.000100", polledAt },
  });
  assert.ok(calls.every((c) => c.auth === `Bearer ${TOKEN}`));
  assert.ok(calls.every((c) => !c.url.includes(TOKEN)));
});

test("history reads 24 h back on first sight and from the cursor minus 600 s after", async () => {
  const calls = stubSlack({
    "auth.test": auth,
    "users.info": users,
    "users.conversations": noDms,
    "conversations.history": () => ({ body: { ok: true, messages: [] } }),
  });
  const cursors: Record<string, SourceCursor> = {
    C0G6ENG: {
      cursor: "1700000600.000100",
      polledAt: "2026-09-28T00:00:00.000Z",
    },
  };
  const result = await source([ENG, GEN]).fetch({ cursors });
  const oldest: Record<string, string | null> = Object.fromEntries(
    calls
      .filter((c) => c.method === "conversations.history")
      .map((c): [string, string | null] => [
        c.params.get("channel") ?? "",
        c.params.get("oldest"),
      ]),
  );
  assert.equal(oldest.C0G6ENG, "1700000000.000100");
  assert.equal(oldest.C0G6GEN, (NOW / 1000 - 86400).toFixed(6));
  assert.ok(
    calls
      .filter((c) => c.method === "conversations.history")
      .every((c) => c.params.get("limit") === "100"),
  );
  assert.equal(result.cursors?.C0G6ENG.cursor, "1700000600.000100");
  assert.equal(result.cursors?.C0G6GEN.cursor, undefined);
});

test("DMs are found over two pages and a deleted user's DM is dropped", async () => {
  const calls = stubSlack({
    "auth.test": auth,
    "users.info": users,
    "users.conversations": (p) =>
      p.get("cursor") === "page2"
        ? {
            body: {
              ok: true,
              channels: [{ id: "D0G6DM2", is_im: true }],
              response_metadata: { next_cursor: "" },
            },
          }
        : {
            body: {
              ok: true,
              channels: [
                { id: "D0G6DM1", is_im: true },
                { id: "D0G6GONE", is_im: true, is_user_deleted: true },
              ],
              response_metadata: { next_cursor: "page2" },
            },
          },
    "conversations.history": () => ({ body: { ok: true, messages: [] } }),
  });
  const result = await source([]).fetch({ cursors: {} });
  const listing = calls.filter((c) => c.method === "users.conversations");
  assert.equal(listing.length, 2);
  assert.equal(listing[0].params.get("types"), "im,mpim");
  assert.equal(listing[0].params.get("exclude_archived"), "true");
  assert.deepEqual(Object.keys(result.cursors ?? {}).sort(), [
    "D0G6DM1",
    "D0G6DM2",
  ]);
});

test("a poll keeps a cursor key that is not a conversation id and drops a DM that left the list", async () => {
  stubSlack({
    "auth.test": auth,
    "users.info": users,
    "users.conversations": noDms,
    "conversations.history": () => ({ body: { ok: true, messages: [] } }),
  });
  const mcp: SourceCursor = {
    cursor: "2026-10-08T00:00:00.000Z",
    polledAt: "2026-10-08T00:30:00.000Z",
    origin: "https://dispatch-test.slack.com",
  };
  const stale: SourceCursor = {
    cursor: "1",
    polledAt: "2023-11-15T00:00:00.000Z",
  };
  const result = await source([ENG]).fetch({
    cursors: { mcp, D0G6OLD: stale },
  });
  assert.deepEqual(result.cursors?.mcp, mcp);
  assert.equal(result.cursors?.D0G6OLD, undefined);
  assert.ok(result.cursors?.C0G6ENG);
});

test("a conversation Slack refuses is skipped with a warning and the rest are read", async () => {
  const warn = mock.method(console, "warn", () => undefined);
  stubSlack({
    "auth.test": auth,
    "users.info": users,
    "users.conversations": noDms,
    "conversations.history": (p) =>
      p.get("channel") === "C0G6GEN"
        ? { body: { ok: false, error: "not_in_channel" } }
        : {
            body: {
              ok: true,
              messages: [
                { ts: "1700000030.000100", user: "U0G6ANA", text: `<@${ME}>` },
              ],
            },
          },
  });
  const result = await source([ENG, GEN]).fetch({ cursors: {} });
  assert.deepEqual(
    result.items.map((i) => i.id),
    ["slack:C0G6ENG:1700000030.000100"],
  );
  assert.deepEqual(result.cursors?.C0G6GEN, {
    polledAt: new Date(NOW).toISOString(),
  });
  assert.equal(warn.mock.callCount(), 1);
  assert.match(
    String(warn.mock.calls[0].arguments[0]),
    /C0G6GEN.*not_in_channel/,
  );
});

test("a channel_not_found skip on a target with a cursor keeps its cursor and moves only polledAt", async () => {
  mock.method(console, "warn", () => undefined);
  stubSlack({
    "auth.test": auth,
    "users.info": users,
    "users.conversations": noDms,
    "conversations.history": () => ({
      body: { ok: false, error: "channel_not_found" },
    }),
  });
  const result = await source([ENG]).fetch({
    cursors: {
      C0G6ENG: {
        cursor: "1700000600.000100",
        polledAt: "2026-09-28T00:00:00.000Z",
      },
    },
  });
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.cursors?.C0G6ENG, {
    cursor: "1700000600.000100",
    polledAt: new Date(NOW).toISOString(),
  });
});

test("a 429 at any step throws RateLimited, and another history refusal fails the poll", async () => {
  stubSlack({
    "auth.test": auth,
    "users.info": users,
    "users.conversations": noDms,
    "conversations.history": () => ({ status: 429, body: { ok: false } }),
  });
  await assert.rejects(source([ENG]).fetch({ cursors: {} }), RateLimited);
  mock.restoreAll();
  stubSlack({ "auth.test": () => ({ status: 429, body: { ok: false } }) });
  await assert.rejects(source([ENG]).fetch({ cursors: {} }), RateLimited);
  mock.restoreAll();
  stubSlack({
    "auth.test": auth,
    "users.info": users,
    "users.conversations": noDms,
    "conversations.history": () => ({
      body: { ok: false, error: "invalid_auth" },
    }),
  });
  await assert.rejects(source([ENG]).fetch({ cursors: {} }), /invalid_auth/);
});

test("a rejected token and a missing credential fail the poll without reading history", async () => {
  const calls = stubSlack({
    "auth.test": () => ({ body: { ok: false, error: "token_revoked" } }),
  });
  await assert.rejects(source([ENG]).fetch({ cursors: {} }), /token_revoked/);
  assert.deepEqual(
    calls.map((c) => c.method),
    ["auth.test"],
  );
  await assert.rejects(
    source([ENG], null).fetch({ cursors: {} }),
    /no Slack credential/,
  );
});

test("45 channels make 40 history calls, and targets left out keep their cursors", async () => {
  const channels = Array.from({ length: 45 }, (_, i) => ({
    id: `C${String(i).padStart(4, "0")}`,
    name: `c${i}`,
  }));
  const cursors: Record<string, SourceCursor> = Object.fromEntries(
    channels.map((c, i) => [
      c.id,
      {
        cursor: "1700000000.000000",
        polledAt: `2026-09-28T00:00:${String(i).padStart(2, "0")}.000Z`,
      },
    ]),
  );
  const calls = stubSlack({
    "auth.test": auth,
    "users.info": users,
    "users.conversations": noDms,
    "conversations.history": () => ({ body: { ok: true, messages: [] } }),
  });
  const result = await source(channels).fetch({ cursors });
  assert.equal(
    calls.filter((c) => c.method === "conversations.history").length,
    40,
  );
  assert.equal(Object.keys(result.cursors ?? {}).length, 45);
  assert.equal(result.cursors?.C0044.polledAt, "2026-09-28T00:00:44.000Z");
});

test("users.info is asked at most 50 times per poll; unknown authors fall back to their id", async () => {
  const messages = Array.from({ length: 60 }, (_, i) => ({
    ts: `17000001${String(i).padStart(2, "0")}.000100`,
    user: `U${String(i).padStart(4, "0")}`,
    text: "hi",
  }));
  const calls = stubSlack({
    "auth.test": auth,
    "users.info": (p) => ({
      body: { ok: true, user: { name: `n-${p.get("user")}`, profile: {} } },
    }),
    "users.conversations": () => ({
      body: {
        ok: true,
        channels: [{ id: "D0G6DM1", is_im: true }],
        response_metadata: { next_cursor: "" },
      },
    }),
    "conversations.history": () => ({ body: { ok: true, messages } }),
  });
  const result = await source([]).fetch({ cursors: {} });
  assert.equal(calls.filter((c) => c.method === "users.info").length, 50);
  assert.equal(result.items.length, 60);
  assert.equal(
    result.items.filter((i) => i.meta.author.startsWith("n-")).length,
    49,
  );
  assert.equal(result.items.at(-1)?.meta.author, "U0059");
});

test("a history row with a malformed ts is dropped and the poll goes on", async () => {
  stubSlack({
    "auth.test": auth,
    "users.info": users,
    "users.conversations": noDms,
    "conversations.history": () => ({
      body: {
        ok: true,
        messages: [
          { ts: "notanumber", user: "U0G6ANA", text: `<@${ME}> a` },
          { ts: "99999999999999.000001", user: "U0G6ANA", text: `<@${ME}> b` },
          { ts: 1700000040, user: "U0G6ANA", text: `<@${ME}> c` },
          { ts: "1700000041.000100", user: "U0G6ANA", text: `<@${ME}> d` },
          { ts: "1700000042.000100", user: "U0G6ANA", text: 42 },
          { ts: "1700000043.000100", user: ["U0G6ANA"], text: `<@${ME}> e` },
          {
            ts: "1700000044.000100",
            user: "U0G6ANA",
            text: `<@${ME}> f`,
            thread_ts: {},
          },
        ],
      },
    }),
  });
  const result = await source([ENG]).fetch({ cursors: {} });
  assert.deepEqual(
    result.items.map((i) => i.id),
    ["slack:C0G6ENG:1700000041.000100"],
  );
  assert.equal(result.cursors?.C0G6ENG.cursor, "1700000041.000100");
});

test("an author Slack will never name is cached as their id; a transient refusal is asked again", async () => {
  const calls = stubSlack({
    "auth.test": auth,
    "users.info": (p) =>
      p.get("user") === "U0G6GONE"
        ? { body: { ok: false, error: "user_not_found" } }
        : p.get("user") === "U0G6FLAKY"
          ? { body: { ok: false, error: "internal_error" } }
          : users(p),
    "users.conversations": noDms,
    "conversations.history": () => ({
      body: {
        ok: true,
        messages: [
          { ts: "1700000060.000100", user: "U0G6GONE", text: `<@${ME}>` },
          { ts: "1700000061.000100", user: "U0G6FLAKY", text: `<@${ME}>` },
        ],
      },
    }),
  });
  const slack = source([ENG]);
  await slack.fetch({ cursors: {} });
  await slack.fetch({ cursors: {} });
  const asked = calls
    .filter((c) => c.method === "users.info")
    .map((c) => c.params.get("user"));
  assert.equal(asked.filter((u) => u === "U0G6GONE").length, 1);
  assert.equal(asked.filter((u) => u === "U0G6FLAKY").length, 2);
});

test("a DM list refused for a missing scope still reads the picked channels; another refusal fails", async () => {
  const warn = mock.method(console, "warn", () => undefined);
  stubSlack({
    "auth.test": auth,
    "users.info": users,
    "users.conversations": () => ({
      body: { ok: false, error: "missing_scope" },
    }),
    "conversations.history": () => ({
      body: {
        ok: true,
        messages: [
          { ts: "1700000050.000100", user: "U0G6ANA", text: `<@${ME}>` },
        ],
      },
    }),
  });
  const dmCursor: SourceCursor = {
    cursor: "1699999000.000100",
    polledAt: "2023-11-15T00:00:00.000Z",
  };
  const result = await source([ENG]).fetch({
    cursors: { D0G6DM1: dmCursor },
  });
  assert.deepEqual(
    result.items.map((i) => i.id),
    ["slack:C0G6ENG:1700000050.000100"],
  );
  assert.deepEqual(result.cursors?.D0G6DM1, dmCursor);
  assert.equal(warn.mock.callCount(), 1);
  mock.restoreAll();
  stubSlack({
    "auth.test": auth,
    "users.info": users,
    "users.conversations": () => ({
      body: { ok: false, error: "invalid_auth" },
    }),
  });
  await assert.rejects(
    source([ENG]).fetch({ cursors: {} }),
    /DM list: invalid_auth/,
  );
});

test("a null DM row is skipped, and a capped DM list and has_more each log one warning", async () => {
  const warn = mock.method(console, "warn", () => undefined);
  const calls = stubSlack({
    "auth.test": auth,
    "users.info": users,
    "users.conversations": (p) => ({
      body: {
        ok: true,
        channels: p.has("cursor") ? [] : [null, { id: "D0G6DM1", is_im: true }],
        response_metadata: { next_cursor: "more" },
      },
    }),
    "conversations.history": () => ({
      body: {
        ok: true,
        has_more: true,
        messages: [
          { ts: "1700000070.000100", user: "U0G6ANA", text: "a" },
          { ts: "1700000071.000100", user: "U0G6ANA", reply_count: "3" },
        ],
      },
    }),
  });
  const result = await source([]).fetch({ cursors: {} });
  assert.equal(
    calls.filter((c) => c.method === "users.conversations").length,
    5,
  );
  assert.deepEqual(
    result.items.map((i) => i.id),
    ["slack:D0G6DM1:1700000070.000100"],
  );
  const lines = warn.mock.calls.map((c) => String(c.arguments[0]));
  assert.equal(lines.filter((l) => l.includes("list cap")).length, 1);
  assert.equal(lines.filter((l) => l.includes("has more than")).length, 1);
});

test("a group DM also picked as a channel is read once, as the channel", async () => {
  const calls = stubSlack({
    "auth.test": auth,
    "users.info": users,
    "users.conversations": () => ({
      body: {
        ok: true,
        channels: [{ id: "G0G6GRP", is_mpim: true }],
        response_metadata: { next_cursor: "" },
      },
    }),
    "conversations.history": () => ({
      body: {
        ok: true,
        messages: [
          { ts: "1700000080.000100", user: "U0G6ANA", text: `<@${ME}> hi` },
        ],
      },
    }),
  });
  const result = await source([{ id: "G0G6GRP", name: "g6-group" }]).fetch({
    cursors: {},
  });
  assert.equal(
    calls.filter((c) => c.method === "conversations.history").length,
    1,
  );
  assert.equal(result.items[0]?.type, "mention");
});

function modeSource(
  mode: SlackMode | undefined,
  credential: { token: string } | null = { token: TOKEN },
) {
  return new SlackSource(
    () =>
      Promise.resolve(
        credential ? { token: credential.token, via: "vault" as const } : null,
      ),
    () => [ENG],
    120_000,
    () => NOW,
    () => mode,
  );
}

test("an explicit mcp mode returns no items and no cursors and makes no Slack request", async () => {
  const calls = stubSlack({});
  const result = await modeSource("mcp").fetch({
    cursors: { C0G6ENG: { cursor: "1", polledAt: "x" } },
  });
  assert.deepEqual(result, { issues: [], items: [], truncated: false });
  assert.equal("cursors" in result, false);
  assert.equal(calls.length, 0);
});

test("an absent mode with no credential returns the same empty result", async () => {
  const calls = stubSlack({});
  const result = await modeSource(undefined, null).fetch();
  assert.deepEqual(result, { issues: [], items: [], truncated: false });
  assert.equal(calls.length, 0);
});

test("an absent mode with a credential polls as before", async () => {
  const calls = stubSlack({
    "auth.test": auth,
    "users.conversations": noDms,
    "conversations.history": () => ({ body: { ok: true, messages: [] } }),
    "users.info": users,
  });
  const result = await modeSource(undefined).fetch();
  assert.ok(result.cursors);
  assert.ok(calls.some((c) => c.method === "auth.test"));
});

test("a garbage mode with no credential returns the empty result like an absent one", async () => {
  const calls = stubSlack({});
  const result = await modeSource("bogus" as SlackMode, null).fetch();
  assert.deepEqual(result, { issues: [], items: [], truncated: false });
  assert.equal(calls.length, 0);
});

test("token mode with no credential still throws", async () => {
  stubSlack({});
  await assert.rejects(
    modeSource("token", null).fetch(),
    /no Slack credential/,
  );
});
