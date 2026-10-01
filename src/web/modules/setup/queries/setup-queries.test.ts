import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { markOnboardingDone, runPrerequisiteInstall } from "./setup-api.js";
import { setupKeys, setupQueryOptions } from "./setup-queries.js";

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

test("setupKeys has the documented shape", () => {
  assert.deepEqual(setupKeys.all, ["setup"]);
  assert.deepEqual(setupKeys.status, ["setup", "status"]);
});

test("setupQueryOptions has the status key and requests /api/setup", async () => {
  const options = setupQueryOptions();
  assert.deepEqual(options.queryKey, ["setup", "status"]);
  reply(200, { onboardingDone: false });
  assert.deepEqual(await newClient().fetchQuery(options), {
    onboardingDone: false,
  });
  assert.equal(calls[0]?.url, "/api/setup");
});

test("markOnboardingDone posts to the onboarding route", async () => {
  reply(200, {});
  await markOnboardingDone();
  assert.equal(calls[0]?.url, "/api/setup/onboarding-done");
  assert.equal(calls[0]?.init?.method, "POST");
});

test("markOnboardingDone throws on a failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    markOnboardingDone(),
    new Error("markOnboardingDone failed: 500 Internal Server Error"),
  );
});

test("runPrerequisiteInstall posts the target and resolves the result", async () => {
  const data = { ok: true, command: "brew install tmux", status: {} };
  reply(200, data);
  assert.deepEqual(await runPrerequisiteInstall("tmux"), data);
  assert.equal(calls[0]?.url, "/api/setup/install");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ target: "tmux" }));
});

test("runPrerequisiteInstall throws on a failure status", async () => {
  reply(400, { error: "bad-target" }, "Bad Request");
  await assert.rejects(
    runPrerequisiteInstall("rm"),
    new Error("runPrerequisiteInstall failed: 400 Bad Request"),
  );
});
