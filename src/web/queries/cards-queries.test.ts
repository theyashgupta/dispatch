import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DEFAULT_BOARD_KEY as LOCAL } from "../../shared/board-key.js";
import type { BoardKey } from "../../shared/types.js";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import {
  cleanupCard,
  createLocalTicket,
  generateGroupTitle,
  generateTicketDraft,
  resetCard,
  startCard,
  startGroup,
  syncCardToLinear,
} from "./cards-api.js";
import {
  createLocalTicketMutationOptions,
  generateGroupTitleMutationOptions,
  generateTicketDraftMutationOptions,
  startCardMutationOptions,
  startGroupMutationOptions,
  syncCardToLinearMutationOptions,
} from "./cards-queries.js";

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

test("generateGroupTitle resolves the phrase on a 200", async () => {
  reply(200, { phrase: "Fix login" });
  const result = await generateGroupTitle(
    ["a", "b"],
    new AbortController().signal,
  );
  assert.deepEqual(result, { ok: true, phrase: "Fix login" });
  assert.equal(calls[0]?.url, "/api/cards/group-title");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ memberIds: ["a", "b"] }));
});

for (const status of [400, 409, 502]) {
  test(`generateGroupTitle resolves not ok on a ${status}`, async () => {
    reply(status, { error: "x" });
    assert.deepEqual(
      await generateGroupTitle(["a"], new AbortController().signal),
      { ok: false },
    );
  });
}

test("generateGroupTitle rejects on a network failure", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("network down"));
  await assert.rejects(
    generateGroupTitle(["a"], new AbortController().signal),
    TypeError,
  );
});

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

function run<V, R>(
  options: { mutationFn: (variables: V) => Promise<R> },
  variables: V,
): Promise<R> {
  return new MutationObserver(new QueryClient(), options).mutate(variables);
}

test("the sync mutation posts the team and the state", async () => {
  reply(200, card);
  const result = await run(syncCardToLinearMutationOptions(), {
    id: "c1",
    teamId: "t1",
    stateId: "s1",
  });
  assert.deepEqual(result, { ok: true, card });
  assert.equal(calls[0]?.url, "/api/cards/c1/sync-linear");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ teamId: "t1", stateId: "s1" }),
  );
});

test("the sync mutation sends no state for the team default", async () => {
  reply(200, card);
  await run(syncCardToLinearMutationOptions(), {
    id: "c1",
    teamId: "t1",
    stateId: "",
  });
  assert.equal(calls[0]?.init?.body, JSON.stringify({ teamId: "t1" }));
});

for (const [status, statusText] of [
  [400, "Bad Request"],
  [409, "Conflict"],
] as const) {
  test(`the sync mutation resolves the server copy on a ${status}`, async () => {
    reply(status, { error: "a sync is already in flight" }, statusText);
    assert.deepEqual(
      await run(syncCardToLinearMutationOptions(), { id: "c1", teamId: "t1" }),
      { ok: false, error: "a sync is already in flight" },
    );
  });
}

test("the sync mutation resolves a null error on a 502", async () => {
  reply(502, { error: "bad gateway" }, "Bad Gateway");
  assert.deepEqual(
    await run(syncCardToLinearMutationOptions(), { id: "c1", teamId: "t1" }),
    { ok: false, error: null },
  );
});

test("the draft mutation posts the direction and resolves the draft", async () => {
  reply(200, { title: "T", description: "D" });
  const signal = new AbortController().signal;
  const result = await run(generateTicketDraftMutationOptions(), {
    direction: "do it",
    signal,
    images: ["img"],
  });
  assert.deepEqual(result, { ok: true, title: "T", description: "D" });
  assert.equal(calls[0]?.url, "/api/cards/draft");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ direction: "do it", images: ["img"] }),
  );
});

for (const status of [400, 409, 502]) {
  test(`the draft mutation resolves not ok on a ${status}`, async () => {
    reply(status, { error: "x" });
    assert.deepEqual(
      await run(generateTicketDraftMutationOptions(), {
        direction: "do it",
        signal: new AbortController().signal,
      }),
      { ok: false },
    );
  });
}

test("the draft mutation rejects when the request aborts", async () => {
  const controller = new AbortController();
  globalThis.fetch = (_url, init) =>
    init?.signal?.aborted
      ? Promise.reject(new DOMException("aborted", "AbortError"))
      : new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
  const pending = run(generateTicketDraftMutationOptions(), {
    direction: "do it",
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("the create mutation posts the ticket and resolves the card", async () => {
  reply(201, card);
  const result = await run(createLocalTicketMutationOptions(LOCAL), {
    title: "T",
    description: "D",
    images: ["img"],
  });
  assert.deepEqual(result, { ok: true, card });
  assert.equal(calls[0]?.url, "/api/cards");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ title: "T", description: "D", images: ["img"] }),
  );
});

test("the create mutation resolves the code on a 400", async () => {
  reply(400, { error: "invalid-title" }, "Bad Request");
  assert.deepEqual(
    await run(createLocalTicketMutationOptions(LOCAL), {
      title: "T",
      description: "D",
    }),
    { ok: false, error: "invalid-title" },
  );
});

for (const status of [409, 502]) {
  test(`the create mutation resolves a null error on a ${status}`, async () => {
    reply(status, { error: "x" });
    assert.deepEqual(
      await run(createLocalTicketMutationOptions(LOCAL), {
        title: "T",
        description: "D",
      }),
      { ok: false, error: null },
    );
  });
}

test("the start mutation posts the folder, repos, playbook and session choice", async () => {
  reply(202, { started: true });
  const result = await run(startCardMutationOptions(), {
    id: "c1",
    extraDirection: "go",
    folder: "/work",
    repos: [{ path: "/work/a", base: "main" }],
    playbook: "GSD",
    newSession: true,
    inheritFrom: "s1",
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0]?.url, "/api/cards/c1/start");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({
      extraDirection: "go",
      folder: "/work",
      repos: [{ path: "/work/a", base: "main" }],
      playbook: "GSD",
      newSession: true,
      inheritFrom: "s1",
    }),
  );
});

test("the start mutation leaves out a new session that is false", async () => {
  reply(202, {});
  await run(startCardMutationOptions(), {
    id: "c1",
    extraDirection: "go",
    folder: "/work",
    repos: [],
    newSession: false,
  });
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ extraDirection: "go", folder: "/work", repos: [] }),
  );
});

test("the start mutation resolves the variant on a 400", async () => {
  reply(400, { error: "repo gone", variant: "config" }, "Bad Request");
  assert.deepEqual(
    await run(startCardMutationOptions(), { id: "c1", extraDirection: "" }),
    { ok: false, error: "repo gone", variant: "config" },
  );
});

test("the start mutation rejects on a 409", async () => {
  reply(409, { error: "busy" }, "Conflict");
  await assert.rejects(
    run(startCardMutationOptions(), { id: "c1", extraDirection: "" }),
    new Error("startCard failed: 409 Conflict"),
  );
});

test("the start group mutation posts the group and resolves the card", async () => {
  reply(202, { card });
  const input = {
    title: "T [2: A-1, A-2]",
    memberIds: ["a", "b"],
    folder: "/work",
    repos: [{ path: "/work/a", base: "main" }],
    playbook: "GSD",
    extraDirection: "go",
  };
  assert.deepEqual(await run(startGroupMutationOptions(LOCAL), input), {
    ok: true,
    card,
  });
  assert.equal(calls[0]?.url, "/api/cards/group");
  assert.equal(calls[0]?.init?.body, JSON.stringify(input));
});

test("the start group mutation resolves the ineligible ids on a 409", async () => {
  reply(409, { error: "no", ineligibleIds: ["a"] }, "Conflict");
  assert.deepEqual(
    await run(startGroupMutationOptions(LOCAL), {
      title: "T",
      memberIds: ["a"],
      folder: "/work",
      repos: [],
    }),
    { ok: false, error: "no", variant: "ineligible", ineligibleIds: ["a"] },
  );
});

test("the group title mutation posts the member ids and resolves the phrase", async () => {
  reply(200, { phrase: "Fix login" });
  const result = await run(generateGroupTitleMutationOptions(), {
    memberIds: ["a", "b"],
    signal: new AbortController().signal,
  });
  assert.deepEqual(result, { ok: true, phrase: "Fix login" });
  assert.equal(calls[0]?.url, "/api/cards/group-title");
});

test("the group title mutation rejects when the request aborts", async () => {
  const controller = new AbortController();
  globalThis.fetch = (_url, init) =>
    init?.signal?.aborted
      ? Promise.reject(new DOMException("aborted", "AbortError"))
      : new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
  const pending = run(generateGroupTitleMutationOptions(), {
    memberIds: ["a"],
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("cleanupCard posts the force flag and resolves on a 200", async () => {
  reply(200, {});
  await cleanupCard("c1", true);
  assert.equal(calls[0]?.url, "/api/cards/c1/cleanup");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ force: true }));
});

test("cleanupCard throws on a non-2xx status", async () => {
  reply(500, { error: "x" }, "Internal Server Error");
  await assert.rejects(
    cleanupCard("c1"),
    new Error("cleanupCard failed: 500 Internal Server Error"),
  );
});

test("resetCard resolves ok on a 200", async () => {
  reply(200, {});
  assert.deepEqual(await resetCard("c1"), { ok: true });
  assert.equal(calls[0]?.url, "/api/cards/c1/reset");
  assert.equal(calls[0]?.init?.method, "POST");
});

test("resetCard returns the server reason for a refusal and throws without one", async () => {
  reply(409, { error: "session is running" });
  assert.deepEqual(await resetCard("c1"), {
    ok: false,
    status: 409,
    error: "session is running",
  });
  reply(500, "", "Internal Server Error");
  await assert.rejects(
    resetCard("c1"),
    new Error("resetCard failed: 500 Internal Server Error"),
  );
});

test("the draft and create mutations drop their variables at once", () => {
  assert.equal(generateTicketDraftMutationOptions().gcTime, 0);
  assert.equal(createLocalTicketMutationOptions(LOCAL).gcTime, 0);
});
