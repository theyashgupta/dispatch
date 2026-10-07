import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { connectSource, saveSourceKey } from "@/queries/source-connection-api";
import {
  listSlackChannels,
  resolveSlackChannel,
  saveSlackChannels,
} from "./connections-api.js";

const answer = (status: number, body: unknown) =>
  mock.method(globalThis, "fetch", () =>
    Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );

afterEach(() => mock.restoreAll());

test("listSlackChannels maps each refusal to the picker's reason", async () => {
  const cases: [number, unknown, string][] = [
    [403, { error: "missing-scope" }, "restricted"],
    [409, { error: "disabled" }, "disabled"],
    [409, { error: "no-credential" }, "rejected"],
    [400, { error: "rejected", providerError: "token_revoked" }, "rejected"],
    [502, { error: "unreachable" }, "unreachable"],
    [500, "<html>proxy</html>", "unreachable"],
    [200, {}, "unreachable"],
  ];
  for (const [status, body, reason] of cases) {
    answer(status, body);
    assert.deepEqual(await listSlackChannels(), { ok: false, reason });
    mock.restoreAll();
  }
});

test("listSlackChannels answers the channels and a missing truncated reads false", async () => {
  const channels = [{ id: "C0G6ENG", name: "eng-platform", private: false }];
  answer(200, { channels });
  assert.deepEqual(await listSlackChannels(), {
    ok: true,
    channels,
    truncated: false,
  });
});

test("a network failure reads as unreachable for list and resolve", async () => {
  mock.method(globalThis, "fetch", () => Promise.reject(new TypeError("x")));
  assert.deepEqual(await listSlackChannels(), {
    ok: false,
    reason: "unreachable",
  });
  assert.deepEqual(await resolveSlackChannel("C0G6ENG"), {
    ok: false,
    reason: "unreachable",
  });
});

test("resolveSlackChannel answers the channel or the refusal reason", async () => {
  answer(200, { id: "C0G6ENG", name: "eng-platform" });
  assert.deepEqual(await resolveSlackChannel("C0G6ENG"), {
    ok: true,
    id: "C0G6ENG",
    name: "eng-platform",
  });
  mock.restoreAll();
  answer(400, { error: "not-a-channel" });
  assert.deepEqual(await resolveSlackChannel("nope"), {
    ok: false,
    reason: "not-a-channel",
  });
  mock.restoreAll();
  answer(200, { id: "C0G6ENG" });
  assert.deepEqual(await resolveSlackChannel("C0G6ENG"), {
    ok: false,
    reason: "unreachable",
  });
});

test("saveSlackChannels answers the stored list, or null on any failure", async () => {
  const channels = [{ id: "C0G6ENG", name: "eng-platform" }];
  answer(200, { channels });
  assert.deepEqual(await saveSlackChannels(channels), channels);
  mock.restoreAll();
  answer(500, { error: "save-failed" });
  assert.equal(await saveSlackChannels(channels), null);
  mock.restoreAll();
  mock.method(globalThis, "fetch", () => Promise.reject(new TypeError("x")));
  assert.equal(await saveSlackChannels(channels), null);
});

test("saveSourceKey keeps only a plain provider code and falls back on the status", async () => {
  answer(400, { error: "rejected", providerError: "token_revoked" });
  assert.deepEqual(await saveSourceKey("slack", "xoxp-x"), {
    ok: false,
    reason: "rejected",
    providerError: "token_revoked",
  });
  mock.restoreAll();
  answer(400, { error: "rejected", providerError: "<b>x</b>" });
  assert.deepEqual(await saveSourceKey("slack", "xoxp-x"), {
    ok: false,
    reason: "rejected",
  });
  mock.restoreAll();
  answer(502, "bad gateway");
  assert.deepEqual(await saveSourceKey("slack", "xoxp-x"), {
    ok: false,
    reason: "unreachable",
  });
});

test("saveSourceKey and connectSource fall back on the status when the body names no kind", async () => {
  answer(400, "not json");
  assert.deepEqual(await saveSourceKey("slack", "xoxp-x"), {
    ok: false,
    reason: "rejected",
  });
  mock.restoreAll();
  answer(500, "oops");
  assert.deepEqual(await saveSourceKey("slack", "xoxp-x"), {
    ok: false,
    reason: "failed",
  });
  mock.restoreAll();
  answer(400, { error: "no-credential" });
  assert.deepEqual(await connectSource("slack"), {
    ok: false,
    reason: "no-credential",
  });
  mock.restoreAll();
  answer(400, { error: "rejected", providerError: "token_revoked" });
  assert.deepEqual(await connectSource("slack"), {
    ok: false,
    reason: "rejected",
    providerError: "token_revoked",
  });
});
