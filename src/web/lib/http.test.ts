import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { http, httpError, payload, type ApiFailure } from "./http.js";

const realFetch = globalThis.fetch;

function reply(status: number, text: string, statusText = ""): void {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(status === 204 ? null : text, { status, statusText }),
    );
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("a 200 with a JSON body resolves ok with the parsed data", async () => {
  reply(200, JSON.stringify({ a: 1 }));
  assert.deepEqual(await http("/api/x"), {
    ok: true,
    status: 200,
    data: { a: 1 },
  });
});

test("a 204 with an empty body resolves ok with null data", async () => {
  reply(204, "");
  assert.deepEqual(await http("/api/x"), { ok: true, status: 204, data: null });
});

test("a 200 with an empty body resolves ok with null data", async () => {
  reply(200, "");
  assert.deepEqual(await http("/api/x"), { ok: true, status: 200, data: null });
});

test("a 200 with a body that is not JSON resolves not ok", async () => {
  reply(200, "not json", "OK");
  assert.deepEqual(await http("/api/x"), {
    ok: false,
    status: 200,
    statusText: "OK",
    error: null,
    body: null,
  });
});

const refusals: [number, string][] = [
  [400, "Bad Request"],
  [404, "Not Found"],
  [409, "Conflict"],
  [429, "Too Many Requests"],
  [502, "Bad Gateway"],
];

for (const [status, statusText] of refusals) {
  test(`a ${status} with an error code resolves not ok with the code and body`, async () => {
    reply(status, JSON.stringify({ error: "some-code" }), statusText);
    assert.deepEqual(await http("/api/x"), {
      ok: false,
      status,
      statusText,
      error: "some-code",
      body: { error: "some-code" },
    });
  });
}

test("a 409 with a non-string error keeps the body and gives a null error", async () => {
  reply(409, JSON.stringify({ error: { code: "x" } }), "Conflict");
  assert.deepEqual(await http("/api/x"), {
    ok: false,
    status: 409,
    statusText: "Conflict",
    error: null,
    body: { error: { code: "x" } },
  });
});

test("a 502 with an empty body gives a null error and a null body", async () => {
  reply(502, "", "Bad Gateway");
  assert.deepEqual(await http("/api/x"), {
    ok: false,
    status: 502,
    statusText: "Bad Gateway",
    error: null,
    body: null,
  });
});

test("a network failure rejects with the same error", async () => {
  const failure = new TypeError("Failed to fetch");
  globalThis.fetch = () => Promise.reject(failure);
  await assert.rejects(http("/api/x"), (err) => err === failure);
});

test("an already aborted signal rejects with an AbortError", async () => {
  globalThis.fetch = (_url: string | URL | Request, init?: RequestInit) =>
    init?.signal?.aborted
      ? Promise.reject(new DOMException("aborted", "AbortError"))
      : Promise.resolve(new Response("{}"));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    http("/api/x", { signal: controller.signal }),
    (err) => err instanceof Error && err.name === "AbortError",
  );
});

test("the url and init object pass through unchanged", async () => {
  const calls: { url: unknown; init?: RequestInit }[] = [];
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response("{}"));
  };
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  };
  await http("/api/x", init);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "/api/x");
  assert.equal(calls[0]?.init, init);
});

function brokenBody(status: number, statusText = ""): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.error(new TypeError("terminated"));
    },
  });
  return new Response(body, { status, statusText });
}

test("a 400 whose body fails to stream reads as an empty body", async () => {
  globalThis.fetch = () => Promise.resolve(brokenBody(400, "Bad Request"));
  assert.deepEqual(await http("/api/x"), {
    ok: false,
    status: 400,
    statusText: "Bad Request",
    error: null,
    body: null,
  });
});

test("a 200 whose body fails to stream gives null data", async () => {
  globalThis.fetch = () => Promise.resolve(brokenBody(200));
  assert.deepEqual(await http("/api/x"), { ok: true, status: 200, data: null });
});

test("a body that fails to stream after an abort still rejects", async () => {
  const controller = new AbortController();
  globalThis.fetch = () => {
    controller.abort();
    return Promise.resolve(brokenBody(200));
  };
  await assert.rejects(http("/api/x", { signal: controller.signal }));
});

function failure(overrides: Partial<ApiFailure> = {}): ApiFailure {
  return {
    ok: false,
    status: 502,
    statusText: "Bad Gateway",
    error: null,
    body: null,
    ...overrides,
  };
}

test("httpError names the function, the status and the status text", () => {
  const err = httpError("getThing", failure());
  assert.ok(err instanceof Error);
  assert.equal(err.message, "getThing failed: 502 Bad Gateway");
});

test("httpError ignores the error code and the body of the failure", () => {
  const err = httpError(
    "getThing",
    failure({
      status: 409,
      statusText: "Conflict",
      error: "x",
      body: { a: 1 },
    }),
  );
  assert.equal(err.message, "getThing failed: 409 Conflict");
});

test("httpError leaves a trailing space when the status text is empty", () => {
  const err = httpError("getThing", failure({ status: 500, statusText: "" }));
  assert.equal(err.message, "getThing failed: 500 ");
});

test("payload returns the data of a success result", () => {
  assert.deepEqual(payload({ ok: true, status: 200, data: { a: 1 } }), {
    a: 1,
  });
  assert.equal(payload({ ok: true, status: 204, data: null }), null);
});

test("payload returns the body of a failure result, not its error code", () => {
  assert.deepEqual(
    payload(failure({ error: "some-code", body: { error: "some-code" } })),
    { error: "some-code" },
  );
  assert.equal(payload(failure()), null);
});
