import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { boardErrorText, parseBoardRefusal } from "./board-create-api.js";
import { createBoardMutationOptions } from "./board-create-queries.js";

const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];

function reply(status: number, body: unknown, statusText = ""): void {
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url:
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      init,
    });
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, statusText }),
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

const board = { key: "ACME", name: "Acme" };

test("create posts the input as JSON and resolves the board and the link", async () => {
  reply(201, { board, link: "/boards/ACME" });
  const input = {
    name: "Acme",
    key: "ACME",
    workspaceRoot: "/w",
    repositories: [{ path: "/r" }],
    linearTeamKeys: ["ENG"],
  };
  const result =
    await createBoardMutationOptions(newClient()).mutationFn(input);
  assert.deepEqual(result, { ok: true, board, link: "/boards/ACME" });
  assert.equal(calls[0]?.url, "/api/boards");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, JSON.stringify(input));
});

test("a name-only input posts only the name", async () => {
  reply(201, { board, link: "/boards/ACME" });
  await createBoardMutationOptions(newClient()).mutationFn({ name: "Acme" });
  assert.equal(calls[0]?.init?.body, JSON.stringify({ name: "Acme" }));
});

test("a 400 resolves the copy, the code and the details as data", async () => {
  reply(
    400,
    {
      error: "Board Acme uses this key.",
      code: "duplicate-key",
      suggestion: "ACME2",
    },
    "Bad Request",
  );
  const result = await createBoardMutationOptions(newClient()).mutationFn({
    name: "Acme",
    key: "ACME",
  });
  assert.deepEqual(result, {
    ok: false,
    error: "Board Acme uses this key.",
    code: "duplicate-key",
    suggestion: "ACME2",
  });
});

test("a folder refusal keeps its field and path", async () => {
  reply(400, {
    error: "This folder does not exist.",
    code: "folder-missing",
    field: "repositories",
    path: "/nope",
  });
  const result = await createBoardMutationOptions(newClient()).mutationFn({
    name: "Acme",
    repositories: [{ path: "/nope" }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.field, "repositories");
  assert.equal(result.ok === false && result.path, "/nope");
});

test("a schema code with no variant resolves its UI copy", async () => {
  reply(400, { error: "invalid-repository" }, "Bad Request");
  const result = await createBoardMutationOptions(newClient()).mutationFn({
    name: "Acme",
  });
  assert.equal(
    result.ok === false && result.error,
    "Enter the path of a git repository.",
  );
  assert.equal(result.ok === false && result.code, "invalid-repository");
});

test("any other failure and a network failure resolve as a refusal", async () => {
  reply(500, {}, "Server Error");
  assert.deepEqual(
    await createBoardMutationOptions(newClient()).mutationFn({ name: "Acme" }),
    { ok: false, error: "500 Server Error", code: "unknown" },
  );
  globalThis.fetch = () => Promise.reject(new Error("offline"));
  assert.deepEqual(
    await createBoardMutationOptions(newClient()).mutationFn({ name: "Acme" }),
    { ok: false, error: "offline", code: "network" },
  );
});

test("boardErrorText maps a schema code and passes any other text through", () => {
  assert.equal(
    boardErrorText("invalid-repository"),
    "Enter the path of a git repository.",
  );
  assert.equal(boardErrorText("board-archived"), "This board is archived.");
  assert.equal(boardErrorText("Key is taken."), "Key is taken.");
  assert.equal(boardErrorText("constructor"), "constructor");
});

test("parseBoardRefusal keeps only the detail strings the body holds", () => {
  const failure = {
    ok: false as const,
    status: 400,
    statusText: "Bad Request",
    error: "Gone.",
    body: { error: "Gone.", code: "folder-missing", field: 3, path: "/nope" },
  };
  assert.deepEqual(parseBoardRefusal(failure), {
    error: "Gone.",
    code: "folder-missing",
    path: "/nope",
  });
  assert.deepEqual(parseBoardRefusal({ ...failure, error: null, body: null }), {
    error: "400 Bad Request",
    code: "unknown",
  });
});

test("a created board invalidates the board list keys before it resolves", async () => {
  const client = newClient();
  let settled = false;
  client.invalidateQueries = (filters) => {
    assert.deepEqual(filters?.queryKey, ["boards"]);
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        settled = true;
        resolve();
      }, 5),
    );
  };
  await createBoardMutationOptions(client).onSuccess({
    ok: true,
    board: board as never,
    link: "/boards/ACME",
  });
  assert.equal(settled, true);
});

test("a refused create leaves the cache alone", async () => {
  const client = newClient();
  client.invalidateQueries = () => assert.fail("must not invalidate");
  await createBoardMutationOptions(client).onSuccess({
    ok: false,
    error: "no",
    code: "x",
  });
});
