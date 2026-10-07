import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DEFAULT_BOARD_KEY as LOCAL } from "../../shared/board-key.js";
import type { BoardKey } from "../../shared/types.js";
import {
  createLocalTicket,
  generateTicketDraft,
  startCard,
  startGroup,
  syncCardToLinear,
} from "./cards-api.js";

const ACME = "ACME" as BoardKey;
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

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

const card = { id: "c1", title: "A card" };

test("startCard sends the fresh-start body with folder and repos", async () => {
  reply(202, { started: true });
  await startCard("c1", "go", "/work", [{ path: "/work/a", base: "main" }]);
  assert.equal(calls[0]?.url, "/api/cards/c1/start");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({
      extraDirection: "go",
      folder: "/work",
      repos: [{ path: "/work/a", base: "main" }],
    }),
  );
});

test("startCard sends only the direction on a restart", async () => {
  reply(202, { started: true });
  await startCard("c1", "again");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ extraDirection: "again" }),
  );
});

test("startCard resolves ok on a 202", async () => {
  reply(202, { started: true }, "Accepted");
  assert.deepEqual(await startCard("c1", "go"), { ok: true });
});

test("startCard maps a 400 body to error and variant", async () => {
  reply(400, { error: "no repo", variant: "config" }, "Bad Request");
  assert.deepEqual(await startCard("c1", "go"), {
    ok: false,
    error: "no repo",
    variant: "config",
  });
});

test("startCard falls back to Start failed. on a 400 with no error", async () => {
  reply(400, {}, "Bad Request");
  assert.deepEqual(await startCard("c1", "go"), {
    ok: false,
    error: "Start failed.",
    variant: undefined,
  });
});

test("startCard falls back to Start failed. on a 400 with a non-JSON body", async () => {
  reply(400, "<html>", "Bad Request");
  assert.deepEqual(await startCard("c1", "go"), {
    ok: false,
    error: "Start failed.",
    variant: undefined,
  });
});

test("startCard throws on any other status", async () => {
  reply(500, { error: "boom" }, "Internal Server Error");
  await assert.rejects(
    startCard("c1", "go"),
    new Error("startCard failed: 500 Internal Server Error"),
  );
});

const groupInput = {
  title: "G",
  memberIds: ["a", "b"],
  folder: "/work",
  repos: [{ path: "/work/a", base: "main" }],
};

test("startGroup resolves the created card on a 202", async () => {
  reply(202, { card }, "Accepted");
  assert.deepEqual(await startGroup(LOCAL, groupInput), { ok: true, card });
  assert.equal(calls[0]?.url, "/api/cards/group");
  assert.equal(calls[0]?.init?.body, JSON.stringify(groupInput));
});

test("startGroup keeps the config variant on a 400", async () => {
  reply(400, { error: "no repo", variant: "config" }, "Bad Request");
  assert.deepEqual(await startGroup(LOCAL, groupInput), {
    ok: false,
    error: "no repo",
    variant: "config",
  });
});

test("startGroup keeps the playbook variant on a 400", async () => {
  reply(400, { error: "bad playbook", variant: "playbook" }, "Bad Request");
  assert.deepEqual(await startGroup(LOCAL, groupInput), {
    ok: false,
    error: "bad playbook",
    variant: "playbook",
  });
});

test("startGroup drops an unknown variant on a 400", async () => {
  reply(400, { error: "x", variant: "ineligible" }, "Bad Request");
  assert.deepEqual(await startGroup(LOCAL, groupInput), {
    ok: false,
    error: "x",
    variant: undefined,
  });
});

test("startGroup falls back to Start failed. on a 400 with no error", async () => {
  reply(400, {}, "Bad Request");
  assert.deepEqual(await startGroup(LOCAL, groupInput), {
    ok: false,
    error: "Start failed.",
    variant: undefined,
  });
});

test("startGroup reports the ineligible ids on a 409", async () => {
  reply(409, { error: "moved on", ineligibleIds: ["b"] }, "Conflict");
  assert.deepEqual(await startGroup(LOCAL, groupInput), {
    ok: false,
    error: "moved on",
    variant: "ineligible",
    ineligibleIds: ["b"],
  });
});

test("startGroup falls back to the eligibility copy and an empty id list on a 409", async () => {
  reply(409, {}, "Conflict");
  assert.deepEqual(await startGroup(LOCAL, groupInput), {
    ok: false,
    error: "Some selected tickets are no longer eligible.",
    variant: "ineligible",
    ineligibleIds: [],
  });
});

test("startGroup throws on any other failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    startGroup(LOCAL, groupInput),
    new Error("startGroup failed: 500 Internal Server Error"),
  );
});

test("startGroup throws on a 2xx that is not a 202", async () => {
  reply(200, { card }, "OK");
  await assert.rejects(
    startGroup(LOCAL, groupInput),
    /^Error: startGroup failed: 200/,
  );
});

test("syncCardToLinear resolves the adopted card on a 200", async () => {
  reply(200, card, "OK");
  assert.deepEqual(await syncCardToLinear("c1", { teamId: "t" }), {
    ok: true,
    card,
  });
  assert.equal(calls[0]?.url, "/api/cards/c1/sync-linear");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ teamId: "t" }));
});

test("syncCardToLinear carries the server copy on a 400", async () => {
  reply(400, { error: "bad team" }, "Bad Request");
  assert.deepEqual(await syncCardToLinear("c1", { teamId: "t" }), {
    ok: false,
    error: "bad team",
  });
});

test("syncCardToLinear carries the server copy on a 409", async () => {
  reply(409, { error: "already synced" }, "Conflict");
  assert.deepEqual(await syncCardToLinear("c1", { teamId: "t" }), {
    ok: false,
    error: "already synced",
  });
});

test("syncCardToLinear answers a null error on a 400 with no error", async () => {
  reply(400, {}, "Bad Request");
  assert.deepEqual(await syncCardToLinear("c1", { teamId: "t" }), {
    ok: false,
    error: null,
  });
});

test("syncCardToLinear answers a null error on any other status", async () => {
  reply(502, { error: "upstream" }, "Bad Gateway");
  assert.deepEqual(await syncCardToLinear("c1", { teamId: "t" }), {
    ok: false,
    error: null,
  });
});

test("syncCardToLinear answers a null error on a network failure", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
  assert.deepEqual(await syncCardToLinear("c1", { teamId: "t" }), {
    ok: false,
    error: null,
  });
});

test("generateTicketDraft resolves the draft on a 200", async () => {
  reply(200, { title: "T", description: "D" }, "OK");
  const signal = new AbortController().signal;
  assert.deepEqual(await generateTicketDraft("do it", signal, ["img"]), {
    ok: true,
    title: "T",
    description: "D",
  });
  assert.equal(calls[0]?.url, "/api/cards/draft");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ direction: "do it", images: ["img"] }),
  );
  assert.equal(calls[0]?.init?.signal, signal);
});

for (const [status, statusText] of [
  [400, "Bad Request"],
  [409, "Conflict"],
  [502, "Bad Gateway"],
] as const) {
  test(`generateTicketDraft resolves not ok on a ${status}`, async () => {
    reply(status, { error: "x" }, statusText);
    assert.deepEqual(
      await generateTicketDraft("do it", new AbortController().signal),
      { ok: false },
    );
  });
}

test("generateTicketDraft rejects on a network failure", async () => {
  const failure = new TypeError("Failed to fetch");
  globalThis.fetch = () => Promise.reject(failure);
  await assert.rejects(
    generateTicketDraft("do it", new AbortController().signal),
    (err) => err === failure,
  );
});

test("createLocalTicket resolves the created card on a 201", async () => {
  reply(201, card, "Created");
  assert.deepEqual(await createLocalTicket(LOCAL, "T", "D"), {
    ok: true,
    card,
  });
  assert.equal(calls[0]?.url, "/api/cards");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ title: "T", description: "D", images: [] }),
  );
});

test("createLocalTicket returns the error code on a 400", async () => {
  reply(400, { error: "title-required" }, "Bad Request");
  assert.deepEqual(await createLocalTicket(LOCAL, "", "D"), {
    ok: false,
    error: "title-required",
  });
});

test("createLocalTicket answers a null error on a 400 with no error", async () => {
  reply(400, {}, "Bad Request");
  assert.deepEqual(await createLocalTicket(LOCAL, "", "D"), {
    ok: false,
    error: null,
  });
});

test("createLocalTicket answers a null error on any other status", async () => {
  reply(500, { error: "boom" }, "Internal Server Error");
  assert.deepEqual(await createLocalTicket(LOCAL, "T", "D"), {
    ok: false,
    error: null,
  });
});

test("createLocalTicket answers a null error on a network failure", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
  assert.deepEqual(await createLocalTicket(LOCAL, "T", "D"), {
    ok: false,
    error: null,
  });
});

test("createLocalTicket and startGroup for ACME post with the board parameter", async () => {
  reply(201, card);
  await createLocalTicket(ACME, "T", "D");
  assert.equal(calls[0]?.url, "/api/cards?board=ACME");
  reply(202, { card }, "Accepted");
  await startGroup(ACME, groupInput);
  assert.equal(calls[1]?.url, "/api/cards/group?board=ACME");
});

test("createLocalTicket for LOCAL keeps the URL of today", async () => {
  reply(201, card);
  await createLocalTicket(LOCAL, "T", "D");
  assert.equal(calls[0]?.url, "/api/cards");
});
