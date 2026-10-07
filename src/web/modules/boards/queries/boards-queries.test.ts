import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import type { BoardKey } from "../../../../shared/types.js";
import {
  archiveBoardMutationOptions,
  boardDetailQueryOptions,
  boardsKeys,
  createBoardMutationOptions,
  restoreBoardMutationOptions,
  updateBoardMutationOptions,
} from "./boards-queries.js";

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

const ACME = "ACME" as BoardKey;
const board = { key: "ACME", name: "Acme" };
const refusal = (error: string) => ({ ok: false as const, error });

test("boardsKeys nest the detail key under the board list keys", () => {
  assert.deepEqual(boardsKeys.detail(ACME), ["boards", "detail", "ACME"]);
});

test("boardDetailQueryOptions requests GET /api/boards/:key and reads the board", async () => {
  reply(200, { board });
  const options = boardDetailQueryOptions(ACME);
  assert.deepEqual(options.queryKey, ["boards", "detail", "ACME"]);
  assert.deepEqual(await newClient().fetchQuery(options), board);
  assert.equal(calls[0]?.url, "/api/boards/ACME");
  assert.equal(calls[0]?.init?.method, undefined);
});

test("boardDetailQueryOptions rejects a non-2xx response", async () => {
  reply(404, { error: "unknown-board" }, "Not Found");
  await assert.rejects(
    newClient().fetchQuery({
      ...boardDetailQueryOptions(ACME),
      retry: false,
    }),
    new Error("getBoardDetail failed: 404 Not Found"),
  );
});

test("create posts the input as JSON", async () => {
  reply(201, { board });
  const input = {
    key: "ACME",
    name: "Acme",
    workspaceRoot: "/w",
    repositories: [{ path: "/r" }],
    linearTeamKeys: [],
  };
  const result =
    await createBoardMutationOptions(newClient()).mutationFn(input);
  assert.deepEqual(result, { ok: true, board });
  assert.equal(calls[0]?.url, "/api/boards");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, JSON.stringify(input));
});

test("update patches /api/boards/:key with the input", async () => {
  reply(200, { board });
  const input = {
    name: "Acme",
    workspaceRoot: "/w",
    repositories: [{ path: "/r" }],
  };
  await updateBoardMutationOptions(newClient()).mutationFn({
    key: ACME,
    input,
  });
  assert.equal(calls[0]?.url, "/api/boards/ACME");
  assert.equal(calls[0]?.init?.method, "PATCH");
  assert.equal(calls[0]?.init?.body, JSON.stringify(input));
});

test("archive and restore post to their paths with no body", async () => {
  reply(200, { board });
  await archiveBoardMutationOptions(newClient()).mutationFn(ACME);
  await restoreBoardMutationOptions(newClient()).mutationFn(ACME);
  assert.equal(calls[0]?.url, "/api/boards/ACME/archive");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, undefined);
  assert.equal(calls[1]?.url, "/api/boards/ACME/restore");
  assert.equal(calls[1]?.init?.method, "POST");
});

test("a refusal resolves its error text as data", async () => {
  reply(400, { error: "Enter a name.", code: "missing-name" }, "Bad Request");
  const result = await createBoardMutationOptions(newClient()).mutationFn({
    key: "ACME",
    name: "",
    workspaceRoot: "/w",
    repositories: [],
    linearTeamKeys: [],
  });
  assert.deepEqual(result, refusal("Enter a name."));
});

test("a schema code resolves as its UI copy and any other text passes through", async () => {
  const copy = {
    "invalid-base-branch": "Enter a valid branch name.",
    "invalid-check-command": "Enter a valid check command.",
    "invalid-linear-team-keys":
      "Team keys use capital letters and digits, like ENG.",
    "invalid-repository": "Enter the path of a git repository.",
    "unsupported-field": "This field cannot be changed.",
  };
  for (const [code, text] of Object.entries(copy)) {
    reply(400, { error: code }, "Bad Request");
    assert.deepEqual(
      await archiveBoardMutationOptions(newClient()).mutationFn(ACME),
      refusal(text),
      code,
    );
  }
  reply(400, { error: "Some new server text" }, "Bad Request");
  assert.deepEqual(
    await archiveBoardMutationOptions(newClient()).mutationFn(ACME),
    refusal("Some new server text"),
  );
  reply(400, { error: "constructor" }, "Bad Request");
  assert.deepEqual(
    await archiveBoardMutationOptions(newClient()).mutationFn(ACME),
    refusal("constructor"),
  );
});

test("a refusal with no readable error falls back to the status line", async () => {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response("", { status: 500, statusText: "Server Error" }),
    );
  assert.deepEqual(
    await archiveBoardMutationOptions(newClient()).mutationFn(ACME),
    refusal("500 Server Error"),
  );
});

test("a successful write invalidates the board list keys before it resolves", async () => {
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
  });
  assert.equal(settled, true);
});

test("a refused write leaves the cache alone", async () => {
  const client = newClient();
  client.invalidateQueries = () => assert.fail("must not invalidate");
  await archiveBoardMutationOptions(client).onSuccess(refusal("no"));
});

test("a network failure resolves as a refusal", async () => {
  globalThis.fetch = () => Promise.reject(new Error("offline"));
  assert.deepEqual(
    await restoreBoardMutationOptions(newClient()).mutationFn(ACME),
    refusal("offline"),
  );
});
