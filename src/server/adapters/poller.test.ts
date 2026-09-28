import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";
import {
  fakeItem,
  issue,
  makeFakeSource,
} from "../test-support/fake-source.js";
import type { SourceIssue } from "../../shared/types.js";

isolateEnv();
const { store } = await import("../store/board.store.js");
const { buildRegistry } = await import("../sources/registry.js");
const {
  pollNow,
  pollerDiagnostics,
  startEnabledPollers,
  startPollers,
  stopPollers,
} = await import("./poller.js");
const { RateLimited } = await import("../sources/ticket.source.js");
await store.load();

afterEach(() => stopPollers());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Deferred {
  resolve: (v: { issues: SourceIssue[]; truncated: boolean }) => void;
  reject: (e: Error) => void;
}

function controllable(id: string, pollIntervalMs: number) {
  const pending: Deferred[] = [];
  let fetches = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  const source = makeFakeSource({
    id,
    pollIntervalMs,
    fetch: () => {
      fetches += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      return new Promise((resolve, reject) => {
        pending.push({
          resolve: (v) => {
            concurrent -= 1;
            resolve(v);
          },
          reject: (e) => {
            concurrent -= 1;
            reject(e);
          },
        });
      });
    },
  });
  return {
    source,
    pending,
    fetches: () => fetches,
    maxConcurrent: () => maxConcurrent,
    settleAll(issues: SourceIssue[] = []) {
      for (const d of pending.splice(0))
        d.resolve({ issues, truncated: false });
    },
  };
}

function cardsOf(source: string): string[] {
  return store
    .snapshot()
    .cards.filter((c) => c.source === source)
    .map((c) => c.id)
    .sort();
}

test("two sources poll on their own cadence and apply under their own id", async () => {
  let a = 0;
  let b = 0;
  const fast = makeFakeSource({
    id: "fast",
    pollIntervalMs: 10,
    fetch: () => {
      a += 1;
      return Promise.resolve({ issues: [issue("f1")], truncated: false });
    },
  });
  const slow = makeFakeSource({
    id: "slow",
    pollIntervalMs: 40,
    fetch: () => {
      b += 1;
      return Promise.resolve({ issues: [issue("s1")], truncated: false });
    },
  });
  startPollers([fast, slow]);
  await sleep(130);
  stopPollers();
  assert.ok(b >= 2 && b <= 5, `slow polled ${b} times`);
  assert.ok(a > b * 2, `fast ${a} should outpace slow ${b}`);
  assert.deepEqual(cardsOf("fast"), ["f1"]);
  assert.deepEqual(cardsOf("slow"), ["s1"]);
});

test("a source never overlaps itself and runs once more after a coalesced tick", async () => {
  const c = controllable("guard", 5);
  startPollers([c.source]);
  await sleep(1);
  assert.equal(c.fetches(), 1);
  pollNow("guard");
  pollNow("guard");
  await sleep(20);
  assert.equal(c.fetches(), 1, "no second fetch while one is in flight");
  c.settleAll([issue("g1")]);
  await sleep(5);
  assert.equal(c.fetches(), 2, "exactly one rerun after settlement");
  assert.equal(c.maxConcurrent(), 1);
  c.settleAll([issue("g1")]);
});

test("pollNow discards the stale in-flight result and keeps the fresh one", async () => {
  const c = controllable("stale", 1000);
  startPollers([c.source]);
  await sleep(1);
  const first = c.pending[0];
  pollNow("stale");
  await sleep(5);
  first.resolve({ issues: [issue("old")], truncated: false });
  await sleep(10);
  assert.deepEqual(
    cardsOf("stale"),
    [],
    "stale result never reached the store",
  );
  c.settleAll([issue("fresh")]);
  await sleep(10);
  assert.deepEqual(cardsOf("stale"), ["fresh"]);
});

test("pollNow on one source leaves the other source's loop scheduled", async () => {
  let other = 0;
  const target = controllable("target", 1000);
  const bystander = makeFakeSource({
    id: "bystander",
    pollIntervalMs: 10,
    fetch: () => {
      other += 1;
      return Promise.resolve({ issues: [], truncated: false });
    },
  });
  startPollers([target.source, bystander]);
  await sleep(15);
  const before = other;
  pollNow("target");
  await sleep(40);
  assert.ok(
    other > before + 1,
    `bystander kept polling (${before} -> ${other})`,
  );
  target.settleAll();
});

test("a RateLimited throw doubles only that source's backoff", async () => {
  let calls = 0;
  const limited = makeFakeSource({
    id: "limited",
    pollIntervalMs: 20,
    fetch: () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new RateLimited())
        : Promise.resolve({ issues: [], truncated: false });
    },
  });
  const steady = makeFakeSource({
    id: "steady",
    pollIntervalMs: 20,
    fetch: () => Promise.resolve({ issues: [], truncated: false }),
  });
  startPollers([limited, steady]);
  await sleep(5);
  const diag = Object.fromEntries(
    pollerDiagnostics().map((d) => [d.id, d.backoffMs]),
  );
  assert.equal(diag.limited, 40);
  assert.equal(diag.steady, 20);
});

test("pollNow returns false for an unknown source and a non-positive interval falls back", () => {
  assert.equal(pollNow("nope"), false);
  startPollers([makeFakeSource({ id: "zero", pollIntervalMs: 0 })]);
  assert.equal(
    pollerDiagnostics().find((d) => d.id === "zero")?.backoffMs,
    60_000,
  );
});

test("restarting keeps a live loop in place and drops sources that are gone", async () => {
  const a = controllable("a", 1000);
  const b = controllable("b", 1000);
  startPollers([a.source, b.source]);
  await sleep(1);
  startPollers([a.source]);
  await sleep(1);
  assert.deepEqual(
    pollerDiagnostics().map((d) => d.id),
    ["a"],
  );
  assert.equal(a.fetches(), 1, "the live loop waits for its in-flight fetch");
  assert.equal(pollNow("b"), false, "a retired loop refuses pollNow");
  a.settleAll();
  b.settleAll();
});

test("a loop retired while its fetch is in flight never reruns or applies", async () => {
  const c = controllable("retired", 5);
  startPollers([c.source]);
  await sleep(1);
  pollNow("retired");
  stopPollers();
  c.settleAll([issue("orphan")]);
  await sleep(30);
  assert.equal(c.fetches(), 1);
  assert.deepEqual(cardsOf("retired"), []);
  assert.deepEqual(pollerDiagnostics(), []);
});

test("re-adding a source while its old fetch is in flight reuses the in-flight guard", async () => {
  const c = controllable("revived", 1000);
  startPollers([c.source]);
  await sleep(1);
  stopPollers();
  startPollers([c.source]);
  await sleep(5);
  assert.equal(c.fetches(), 1, "the revived loop waits for the old fetch");
  c.settleAll([issue("rv-stale")]);
  await sleep(5);
  assert.equal(c.fetches(), 2, "one rerun once the old fetch settles");
  assert.equal(c.maxConcurrent(), 1);
  assert.deepEqual(cardsOf("revived"), []);
  c.settleAll([issue("rv-fresh")]);
  await sleep(25);
  assert.deepEqual(cardsOf("revived"), ["rv-fresh"]);
});

test("backoff returns to the base interval after a success that follows a rate limit", async () => {
  let calls = 0;
  const src = makeFakeSource({
    id: "recover",
    pollIntervalMs: 15,
    fetch: () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new RateLimited())
        : Promise.resolve({ issues: [], truncated: false });
    },
  });
  startPollers([src]);
  await sleep(5);
  assert.equal(pollerDiagnostics()[0]?.backoffMs, 30);
  await sleep(45);
  assert.ok(calls >= 2, `recovered poll ran (${calls})`);
  assert.equal(pollerDiagnostics()[0]?.backoffMs, 15);
});

test("a transport failure keeps the loop on its base interval and flags the board unreachable", async () => {
  let calls = 0;
  const src = makeFakeSource({
    id: "offline",
    pollIntervalMs: 10,
    fetch: () => {
      calls += 1;
      return Promise.reject(
        new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") }),
      );
    },
  });
  startPollers([src]);
  for (let waited = 0; calls < 3 && waited < 1000; waited += 10) {
    await sleep(10);
  }
  assert.ok(calls >= 3, `loop kept ticking (${calls})`);
  assert.equal(pollerDiagnostics()[0]?.backoffMs, 10);
  assert.equal(store.snapshot().syncUnreachable, true);
  await store.setSyncUnreachable(false);
});

test("an append source through the poller upserts and never removes or flags", async () => {
  let call = 0;
  const src = makeFakeSource({
    id: "appendsrc",
    kind: "append",
    pollIntervalMs: 10,
    fetch: () => {
      call += 1;
      return Promise.resolve({
        issues: call === 1 ? [issue("ap1"), issue("ap2")] : [issue("ap2")],
        truncated: false,
      });
    },
  });
  startPollers([src]);
  await sleep(60);
  stopPollers();
  assert.ok(call >= 2, `polled ${call} times`);
  assert.deepEqual(cardsOf("appendsrc"), ["ap1", "ap2"]);
  assert.equal(store.getCard("ap1")?.goneFromLinear, false);
});

test("a truncated pull through the poller applies upserts only and records the warning", async () => {
  let call = 0;
  const src = makeFakeSource({
    id: "trunc",
    pollIntervalMs: 10,
    fetch: () => {
      call += 1;
      return Promise.resolve({
        issues: call === 1 ? [issue("tr1"), issue("tr2")] : [issue("tr2")],
        truncated: call !== 1,
      });
    },
  });
  startPollers([src]);
  await sleep(60);
  stopPollers();
  assert.ok(call >= 2, `polled ${call} times`);
  assert.deepEqual(cardsOf("trunc"), ["tr1", "tr2"]);
  assert.match(store.snapshot().syncWarning ?? "", /^trunc pull was truncated/);
  await store.applyIssues(
    [issue("tr1"), issue("tr2")],
    "2026-09-24T10:00:00.000Z",
    {
      source: "trunc",
      kind: "snapshot",
    },
  );
});

test("a plain error keeps the loop on its base interval and leaves the board reachable", async () => {
  let calls = 0;
  const src = makeFakeSource({
    id: "plainerr",
    pollIntervalMs: 10,
    fetch: () => {
      calls += 1;
      return Promise.reject(new Error("boom"));
    },
  });
  startPollers([src]);
  for (let waited = 0; calls < 3 && waited < 1000; waited += 10) {
    await sleep(10);
  }
  assert.ok(calls >= 3, `loop kept ticking (${calls})`);
  assert.equal(pollerDiagnostics()[0]?.backoffMs, 10);
  assert.equal(store.snapshot().syncUnreachable, false);
});

test("restarting with a new source object swaps the fetch and the interval", async () => {
  let oldCalls = 0;
  let newCalls = 0;
  const oldSrc = makeFakeSource({
    id: "swap",
    pollIntervalMs: 1000,
    fetch: () => {
      oldCalls += 1;
      return Promise.resolve({ issues: [], truncated: false });
    },
  });
  const newSrc = makeFakeSource({
    id: "swap",
    pollIntervalMs: 10,
    fetch: () => {
      newCalls += 1;
      return Promise.resolve({ issues: [], truncated: false });
    },
  });
  startPollers([oldSrc]);
  await sleep(5);
  startPollers([newSrc]);
  for (let waited = 0; newCalls < 3 && waited < 1000; waited += 10) {
    await sleep(10);
  }
  assert.equal(oldCalls, 1);
  assert.ok(newCalls >= 3, `new source polled ${newCalls} times`);
  assert.equal(pollerDiagnostics()[0]?.backoffMs, 10);
});

function itemsOf(source: string): [string, string][] {
  return store
    .listItems()
    .filter((i) => i.source === source)
    .map((i) => [i.id, i.state] as [string, string])
    .sort();
}

test("a snapshot source's items follow the auto-done rule through the real poller", async () => {
  let call = 0;
  const src = makeFakeSource({
    id: "isnap",
    pollIntervalMs: 10,
    fetch: () => {
      call += 1;
      return Promise.resolve({
        issues: [],
        items:
          call === 1
            ? [
                fakeItem("a", { source: "isnap" }),
                fakeItem("b", { source: "isnap" }),
              ]
            : [fakeItem("a", { source: "isnap" })],
        truncated: false,
      });
    },
  });
  startPollers([src]);
  await sleep(60);
  stopPollers();
  assert.ok(call >= 2, `polled ${call} times`);
  assert.deepEqual(itemsOf("isnap"), [
    ["isnap:a", "unread"],
    ["isnap:b", "done"],
  ]);
});

test("an append source's items are never auto-done through the poller", async () => {
  let call = 0;
  const src = makeFakeSource({
    id: "iapp",
    kind: "append",
    pollIntervalMs: 10,
    fetch: () => {
      call += 1;
      return Promise.resolve({
        issues: [],
        items:
          call === 1
            ? [
                fakeItem("a", { source: "iapp" }),
                fakeItem("b", { source: "iapp" }),
              ]
            : [fakeItem("a", { source: "iapp" })],
        truncated: false,
      });
    },
  });
  startPollers([src]);
  await sleep(60);
  stopPollers();
  assert.ok(call >= 2, `polled ${call} times`);
  assert.deepEqual(itemsOf("iapp"), [
    ["iapp:a", "unread"],
    ["iapp:b", "unread"],
  ]);
});

test("a truncated snapshot pull auto-dones no items", async () => {
  let call = 0;
  const src = makeFakeSource({
    id: "itrunc",
    pollIntervalMs: 10,
    fetch: () => {
      call += 1;
      return Promise.resolve({
        issues: [],
        items:
          call === 1
            ? [
                fakeItem("a", { source: "itrunc" }),
                fakeItem("b", { source: "itrunc" }),
              ]
            : [fakeItem("a", { source: "itrunc" })],
        truncated: call !== 1,
      });
    },
  });
  startPollers([src]);
  await sleep(60);
  stopPollers();
  assert.ok(call >= 2, `polled ${call} times`);
  assert.deepEqual(itemsOf("itrunc"), [
    ["itrunc:a", "unread"],
    ["itrunc:b", "unread"],
  ]);
  await store.applyIssues([], "2026-09-24T10:00:00.000Z", {
    source: "itrunc",
    kind: "snapshot",
  });
});

test("a source that returns no items field touches no item rows", async () => {
  const before = store.listItems().length;
  let fetches = 0;
  const src = makeFakeSource({
    id: "noitems",
    pollIntervalMs: 10,
    fetch: () => {
      fetches += 1;
      return Promise.resolve({ issues: [], truncated: false });
    },
  });
  startPollers([src]);
  await sleep(25);
  stopPollers();
  assert.ok(fetches >= 1, "the source was polled");
  assert.equal(store.listItems().length, before);
});

test("startEnabledPollers stamps the enabled source ids on the snapshot, and clears them when none is enabled", () => {
  buildRegistry({ linearApiKey: "lin_test", pollIntervalMs: 60_000 });
  startEnabledPollers();
  assert.deepEqual(store.snapshot().enabledSources, ["linear"]);
  stopPollers();
  buildRegistry({ linearApiKey: "", pollIntervalMs: 60_000 });
  startEnabledPollers();
  assert.deepEqual(store.snapshot().enabledSources, []);
  stopPollers();
});
