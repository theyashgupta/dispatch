import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import {
  createPlaybook,
  deletePlaybook,
  generatePlaybookDraft,
  getPlaybooks,
  updatePlaybook,
} from "./playbooks-api.js";
import { getPickerPlaybooks } from "@/queries/playbook-picker-api";
import {
  createPlaybookMutationOptions,
  deletePlaybookMutationOptions,
  generatePlaybookDraftMutationOptions,
  playbooksKeys,
  playbooksQueryOptions,
  updatePlaybookMutationOptions,
} from "./playbooks-queries.js";

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

const input = { name: "Ship it", body: "steps" };
const playbook = { slug: "ship-it", name: "Ship it" };

test("playbooksKeys has the documented shape", () => {
  assert.deepEqual(playbooksKeys.all, ["playbooks"]);
  assert.deepEqual(playbooksKeys.list, ["playbooks", "list"]);
});

test("playbooksQueryOptions requests the playbook list", async () => {
  const options = playbooksQueryOptions();
  assert.deepEqual(options.queryKey, ["playbooks", "list"]);
  reply(200, { playbooks: [playbook] });
  assert.deepEqual(await newClient().fetchQuery(options), [playbook]);
  assert.equal(calls[0]?.url, "/api/playbooks");
});

test("getPlaybooks throws on a failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    getPlaybooks(),
    new Error("getPlaybooks failed: 500 Internal Server Error"),
  );
});

test("getPickerPlaybooks throws on a failure status", async () => {
  reply(503, {}, "Service Unavailable");
  await assert.rejects(
    getPickerPlaybooks(),
    new Error("getPickerPlaybooks failed: 503 Service Unavailable"),
  );
});

test("createPlaybook resolves the playbook on a 200", async () => {
  reply(200, { playbook });
  assert.deepEqual(await createPlaybook(input), { ok: true, playbook });
  assert.equal(calls[0]?.url, "/api/playbooks");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, JSON.stringify(input));
});

test("createPlaybook reads a 409 as name-exists", async () => {
  reply(409, {});
  assert.deepEqual(await createPlaybook(input), {
    ok: false,
    error: "name-exists",
  });
});

test("createPlaybook reads a footgun body as footgun", async () => {
  reply(400, { error: "footgun" });
  assert.deepEqual(await createPlaybook(input), {
    ok: false,
    error: "footgun",
  });
});

test("createPlaybook reads any other error body as generic", async () => {
  reply(400, { error: "other" });
  assert.deepEqual(await createPlaybook(input), {
    ok: false,
    error: "generic",
  });
});

test("createPlaybook reads an unreadable failure body as generic", async () => {
  reply(500, "<html>");
  assert.deepEqual(await createPlaybook(input), {
    ok: false,
    error: "generic",
  });
});

test("updatePlaybook resolves the playbook on a 200", async () => {
  reply(200, { playbook });
  assert.deepEqual(await updatePlaybook("a b", input), {
    ok: true,
    playbook,
  });
  assert.equal(calls[0]?.url, "/api/playbooks/a%20b");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(calls[0]?.init?.body, JSON.stringify(input));
});

test("updatePlaybook reads a 409 as name-exists", async () => {
  reply(409, {});
  assert.deepEqual(await updatePlaybook("a", input), {
    ok: false,
    error: "name-exists",
  });
});

test("updatePlaybook reads a footgun body as footgun", async () => {
  reply(400, { error: "footgun" });
  assert.deepEqual(await updatePlaybook("a", input), {
    ok: false,
    error: "footgun",
  });
});

test("updatePlaybook reads a 404 as generic", async () => {
  reply(404, { error: "not-found" });
  assert.deepEqual(await updatePlaybook("a", input), {
    ok: false,
    error: "generic",
  });
});

test("updatePlaybook reads an unreadable failure body as generic", async () => {
  reply(500, "");
  assert.deepEqual(await updatePlaybook("a", input), {
    ok: false,
    error: "generic",
  });
});

test("deletePlaybook resolves ok true on a 200", async () => {
  reply(200, {});
  assert.deepEqual(await deletePlaybook("a b"), { ok: true });
  assert.equal(calls[0]?.url, "/api/playbooks/a%20b");
  assert.equal(calls[0]?.init?.method, "DELETE");
});

test("deletePlaybook resolves ok false on a 404", async () => {
  reply(404, {});
  assert.deepEqual(await deletePlaybook("a"), { ok: false });
});

test("generatePlaybookDraft resolves the draft on a 200", async () => {
  reply(200, { draft: "# Draft" });
  assert.deepEqual(
    await generatePlaybookDraft({ direction: "go", sourcePaths: ["/a"] }),
    { ok: true, draft: "# Draft" },
  );
  assert.equal(calls[0]?.url, "/api/playbooks/generate");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ direction: "go", sourcePaths: ["/a"] }),
  );
});

test("generatePlaybookDraft resolves ok false on a failure status", async () => {
  reply(500, {});
  assert.deepEqual(
    await generatePlaybookDraft({ direction: "go", sourcePaths: [] }),
    { ok: false },
  );
});

test("generatePlaybookDraft resolves ok false on a network failure", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("network down"));
  assert.deepEqual(
    await generatePlaybookDraft({ direction: "go", sourcePaths: [] }),
    { ok: false },
  );
});

function listIsStale(client: QueryClient): boolean {
  return client.getQueryState(playbooksKeys.list)?.isInvalidated === true;
}

function seededClient(): QueryClient {
  const client = newClient();
  client.setQueryData(playbooksKeys.list, [playbook]);
  return client;
}

test("a created playbook marks the list stale", async () => {
  const client = seededClient();
  reply(200, { playbook });
  const result = await new MutationObserver(
    client,
    createPlaybookMutationOptions(client),
  ).mutate(input);
  assert.deepEqual(result, { ok: true, playbook });
  assert.equal(calls[0]?.url, "/api/playbooks");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(listIsStale(client), true);
});

test("a refused create resolves the typed error and leaves the list alone", async () => {
  const client = seededClient();
  reply(409, {}, "Conflict");
  const result = await new MutationObserver(
    client,
    createPlaybookMutationOptions(client),
  ).mutate(input);
  assert.deepEqual(result, { ok: false, error: "name-exists" });
  assert.equal(listIsStale(client), false);
});

test("a saved playbook edit marks the list stale", async () => {
  const client = seededClient();
  reply(200, { playbook });
  const result = await new MutationObserver(
    client,
    updatePlaybookMutationOptions(client),
  ).mutate({ slug: "ship-it", input });
  assert.deepEqual(result, { ok: true, playbook });
  assert.equal(calls[0]?.url, "/api/playbooks/ship-it");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(listIsStale(client), true);
});

test("a refused edit resolves the typed error and leaves the list alone", async () => {
  const client = seededClient();
  reply(400, { error: "footgun" }, "Bad Request");
  const result = await new MutationObserver(
    client,
    updatePlaybookMutationOptions(client),
  ).mutate({ slug: "ship-it", input });
  assert.deepEqual(result, { ok: false, error: "footgun" });
  assert.equal(listIsStale(client), false);
});

test("a deleted playbook marks the list stale", async () => {
  const client = seededClient();
  reply(200, {});
  const result = await new MutationObserver(
    client,
    deletePlaybookMutationOptions(client),
  ).mutate("ship-it");
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0]?.url, "/api/playbooks/ship-it");
  assert.equal(calls[0]?.init?.method, "DELETE");
  assert.equal(listIsStale(client), true);
});

test("a refused delete resolves ok false and leaves the list alone", async () => {
  const client = seededClient();
  reply(404, {}, "Not Found");
  const result = await new MutationObserver(
    client,
    deletePlaybookMutationOptions(client),
  ).mutate("ship-it");
  assert.deepEqual(result, { ok: false });
  assert.equal(listIsStale(client), false);
});

test("a generated draft resolves the text and never touches the cache", async () => {
  const client = seededClient();
  reply(200, { draft: "# Draft" });
  const result = await new MutationObserver(
    client,
    generatePlaybookDraftMutationOptions,
  ).mutate({ direction: "go", sourcePaths: [] });
  assert.deepEqual(result, { ok: true, draft: "# Draft" });
  assert.equal(calls[0]?.url, "/api/playbooks/generate");
  assert.equal(listIsStale(client), false);
});

test("a failed draft resolves ok false", async () => {
  reply(500, {}, "Internal Server Error");
  const result = await new MutationObserver(
    newClient(),
    generatePlaybookDraftMutationOptions,
  ).mutate({ direction: "go", sourcePaths: [] });
  assert.deepEqual(result, { ok: false });
});

test("the playbooks list is dropped once the page closes, so every open reads it fresh", () => {
  assert.equal(playbooksQueryOptions().gcTime, 0);
});
