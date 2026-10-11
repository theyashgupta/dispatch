import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import type { BoardKey } from "../../shared/types.js";
import {
  initRepositoryErrorText,
  initRepositoryMutationOptions,
} from "./board-repository-queries.js";

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

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

const ACME = "ACME" as BoardKey;
const board = { key: "ACME", name: "Acme" };

test("init posts to the repositories/init path with no body", async () => {
  reply(200, { board });
  const result = await initRepositoryMutationOptions(
    new QueryClient(),
  ).mutationFn(ACME);
  assert.deepEqual(result, { ok: true, board });
  assert.equal(calls[0]?.url, "/api/boards/ACME/repositories/init");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, undefined);
});

test("init resolves the server copy and code of a refusal", async () => {
  reply(
    400,
    {
      error: "Dispatch could not make the repository.",
      code: "git-init-failed",
    },
    "Bad Request",
  );
  assert.deepEqual(
    await initRepositoryMutationOptions(new QueryClient()).mutationFn(ACME),
    {
      ok: false,
      error: "Dispatch could not make the repository.",
      code: "git-init-failed",
    },
  );
});

test("init falls back to the status line, and a network failure resolves as a refusal", async () => {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response("", { status: 502, statusText: "Bad Gateway" }),
    );
  assert.deepEqual(
    await initRepositoryMutationOptions(new QueryClient()).mutationFn(ACME),
    { ok: false, error: "502 Bad Gateway", code: "unknown" },
  );
  globalThis.fetch = () => Promise.reject(new Error("offline"));
  assert.deepEqual(
    await initRepositoryMutationOptions(new QueryClient()).mutationFn(ACME),
    { ok: false, error: "offline", code: "network" },
  );
});

test("a successful init invalidates the board list and the folders of that board", async () => {
  const client = new QueryClient();
  const invalidated: (readonly unknown[] | undefined)[] = [];
  client.invalidateQueries = (filters) => {
    invalidated.push(filters?.queryKey);
    return Promise.resolve();
  };
  await initRepositoryMutationOptions(client).onSuccess(
    { ok: true, board: board as never },
    ACME,
  );
  assert.deepEqual(invalidated, [
    ["boards"],
    ["workspaces", "folders", "ACME"],
  ]);
});

test("a refused init invalidates nothing", async () => {
  const client = new QueryClient();
  let count = 0;
  client.invalidateQueries = () => {
    count += 1;
    return Promise.resolve();
  };
  await initRepositoryMutationOptions(client).onSuccess(
    { ok: false, error: "no", code: "x" },
    ACME,
  );
  assert.equal(count, 0);
});

test("init keeps the git message of a refusal as detail", async () => {
  reply(400, {
    error: "Dispatch could not make the repository.",
    code: "git-init-failed",
    detail: "fatal: cannot mkdir",
  });
  assert.deepEqual(
    await initRepositoryMutationOptions(new QueryClient()).mutationFn(ACME),
    {
      ok: false,
      error: "Dispatch could not make the repository.",
      code: "git-init-failed",
      detail: "fatal: cannot mkdir",
    },
  );
});

test("the init error text adds the git message to the refusal copy", () => {
  const refusal = { ok: false as const, error: "Could not.", code: "x" };
  assert.equal(initRepositoryErrorText(refusal, null), "Could not.");
  assert.equal(
    initRepositoryErrorText({ ...refusal, detail: "fatal: no" }, null),
    "Could not. fatal: no",
  );
  assert.equal(
    initRepositoryErrorText(undefined, new Error("offline")),
    "offline",
  );
  assert.equal(initRepositoryErrorText(undefined, null), null);
});
