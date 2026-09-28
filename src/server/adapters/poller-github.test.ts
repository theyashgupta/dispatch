import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";

isolateEnv();
const { store } = await import("../store/board.store.js");
const { GitHubSource } = await import("../sources/github/github.source.js");
const { startPollers, stopPollers } = await import("./poller.js");
await store.load();

afterEach(() => {
  stopPollers();
  mock.restoreAll();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function searchResponse(numbers: number[], total = numbers.length): Response {
  return new Response(
    JSON.stringify({
      total_count: total,
      incomplete_results: false,
      items: numbers.map((n) => ({
        number: n,
        title: `PR ${n}`,
        body: "",
        html_url: `https://github.com/acme/api/pull/${n}`,
        repository_url: "https://api.github.com/repos/acme/api",
        user: { login: "octo" },
        updated_at: "2026-09-25T09:00:00Z",
      })),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function stubGithub(state: { reviews: number[]; total?: number }): void {
  mock.method(globalThis, "fetch", (input: string) => {
    const q = new URL(input).searchParams.get("q") ?? "";
    return Promise.resolve(
      q.includes("review-requested")
        ? searchResponse(state.reviews, state.total)
        : searchResponse([]),
    );
  });
}

function githubItems(): [string, string][] {
  return store
    .listItems()
    .filter((i) => i.source === "github")
    .map((i) => [i.id, i.state] as [string, string])
    .sort();
}

async function pollUntil(
  source: InstanceType<typeof GitHubSource>,
  done: () => boolean,
): Promise<void> {
  startPollers([source]);
  for (let waited = 0; !done() && waited < 1000; waited += 10) {
    await sleep(10);
  }
  stopPollers();
}

function source(): InstanceType<typeof GitHubSource> {
  return new GitHubSource(
    () => Promise.resolve({ token: "g5-fake-gh-token", via: "gh" }),
    10,
  );
}

test("a complete GitHub pull that no longer returns a PR marks its item done", async () => {
  const state = { reviews: [12, 15] };
  stubGithub(state);
  await pollUntil(source(), () => githubItems().length === 2);
  assert.deepEqual(githubItems(), [
    ["github:acme/api#12", "unread"],
    ["github:acme/api#15", "unread"],
  ]);
  state.reviews = [12];
  await pollUntil(source(), () => githubItems().some(([, s]) => s === "done"));
  assert.deepEqual(githubItems(), [
    ["github:acme/api#12", "unread"],
    ["github:acme/api#15", "done"],
  ]);
});

test("a partial GitHub pull never marks a missing PR done", async () => {
  const state = { reviews: [20, 21], total: 150 };
  stubGithub(state);
  await pollUntil(source(), () =>
    githubItems().some(([id]) => id === "github:acme/api#21"),
  );
  state.reviews = [20];
  let polls = 0;
  mock.restoreAll();
  mock.method(globalThis, "fetch", (input: string) => {
    polls += 1;
    const q = new URL(input).searchParams.get("q") ?? "";
    return Promise.resolve(
      q.includes("review-requested")
        ? searchResponse(state.reviews, state.total)
        : searchResponse([]),
    );
  });
  await pollUntil(source(), () => polls >= 6);
  assert.ok(polls >= 6, `polled ${polls} requests`);
  assert.equal(
    githubItems().find(([id]) => id === "github:acme/api#21")?.[1],
    "unread",
  );
});
