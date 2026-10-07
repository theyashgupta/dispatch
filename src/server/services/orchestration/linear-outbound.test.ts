import assert from "node:assert/strict";
import { test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";
import { issue, makeFakeSource } from "../../test-support/fake-source.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { assignToMe, getWorkflow, invalidateWorkflow, postComment } =
  await import("./linear-outbound.js");
const { OUTBOUND_COPY } = await import("./outbound-error.js");
await store.load();
await store.applyIssues([issue("lin")], new Date().toISOString(), {
  source: "linear",
});

function fakeDeps(fail?: Error) {
  const calls: { issueId: string; body: string }[] = [];
  const assigned: { issueId: string; assigneeId: string }[] = [];
  const polls: string[] = [];
  let workflowReads = 0;
  let clock = 0;
  const settle = () => (fail ? Promise.reject(fail) : Promise.resolve());
  const source = {
    ...makeFakeSource({ id: "linear" }),
    addComment: (issueId: string, body: string) => {
      calls.push({ issueId, body });
      return settle();
    },
    viewerId: () => Promise.resolve("user-me"),
    assignIssue: (issueId: string, assigneeId: string) => {
      assigned.push({ issueId, assigneeId });
      return settle();
    },
    workflow: () => {
      workflowReads += 1;
      return fail
        ? Promise.reject(fail)
        : Promise.resolve({ viewerId: "user-me", teams: [] });
    },
  };
  return {
    calls,
    assigned,
    polls,
    reads: () => workflowReads,
    tick: (ms: number) => {
      clock += ms;
    },
    deps: {
      source: () => source,
      poll: (sourceId: string) => {
        polls.push(sourceId);
        return true;
      },
      now: () => clock,
    },
  };
}

test("a success posts the body, clears linearError and polls linear once", async () => {
  await store.setLinearError("lin", OUTBOUND_COPY.unreachable);
  const f = fakeDeps();
  assert.deepEqual(await postComment("lin", "  hello  ", f.deps), {
    ok: true,
  });
  assert.deepEqual(f.calls, [{ issueId: "lin", body: "  hello  " }]);
  assert.deepEqual(f.polls, ["linear"]);
  assert.equal(store.getCard("lin")?.linearError, null);
});

test("a failure sets the fixed copy, returns it with 502 and never polls", async () => {
  const auth = new Error("HTTP 401 raw detail");
  auth.name = "LinearAuthError";
  const f = fakeDeps(auth);
  assert.deepEqual(await postComment("lin", "hi", f.deps), {
    ok: false,
    status: 502,
    error: OUTBOUND_COPY.auth,
  });
  assert.deepEqual(f.polls, []);
  assert.equal(store.getCard("lin")?.linearError, OUTBOUND_COPY.auth);
});

test("a local card is refused with 409 before the source is called", async () => {
  const local = await store.createLocalCard(DEFAULT_BOARD_KEY, "local", "");
  const f = fakeDeps();
  assert.deepEqual(await postComment(local.id, "hi", f.deps), {
    ok: false,
    status: 409,
    error: "source cannot comment",
  });
  assert.deepEqual(f.calls, []);
  assert.equal(store.getCard(local.id)?.linearError, undefined);
});

test("an unknown card is refused with 404", async () => {
  const f = fakeDeps();
  assert.deepEqual(await postComment("nope", "hi", f.deps), {
    ok: false,
    status: 404,
    error: "unknown card id: nope",
  });
  assert.deepEqual(f.calls, []);
});

test("a card with no source field posts as a Linear card", async () => {
  await store.applyIssues(
    [issue("lin"), issue("legacy")],
    new Date().toISOString(),
    {
      source: "linear",
    },
  );
  const legacy = store.getCard("legacy");
  assert.ok(legacy);
  delete legacy.source;
  const f = fakeDeps();
  assert.deepEqual(await postComment("legacy", "hi", f.deps), { ok: true });
  assert.deepEqual(f.calls, [{ issueId: "legacy", body: "hi" }]);
});

test("setLinearError on an unknown card changes nothing", async () => {
  const before = JSON.stringify(store.snapshot(DEFAULT_BOARD_KEY).cards);
  await store.setLinearError("no-such-card", OUTBOUND_COPY.auth);
  assert.equal(JSON.stringify(store.snapshot(DEFAULT_BOARD_KEY).cards), before);
});

test("assign to me assigns the viewer, clears linearError and polls linear once", async () => {
  await store.setLinearError("lin", OUTBOUND_COPY.unreachable);
  const f = fakeDeps();
  assert.deepEqual(await assignToMe("lin", f.deps), { ok: true });
  assert.deepEqual(f.assigned, [{ issueId: "lin", assigneeId: "user-me" }]);
  assert.deepEqual(f.polls, ["linear"]);
  assert.equal(store.getCard("lin")?.linearError, null);
});

test("a failed assign sets the fixed copy, answers 502 and never polls", async () => {
  const auth = new Error("HTTP 401");
  auth.name = "LinearAuthError";
  const f = fakeDeps(auth);
  assert.deepEqual(await assignToMe("lin", f.deps), {
    ok: false,
    status: 502,
    error: OUTBOUND_COPY.auth,
  });
  assert.deepEqual(f.polls, []);
  assert.equal(store.getCard("lin")?.linearError, OUTBOUND_COPY.auth);
});

test("assign on a local card answers 409 before the source", async () => {
  const local = await store.createLocalCard(
    DEFAULT_BOARD_KEY,
    "local assign",
    "",
  );
  const f = fakeDeps();
  assert.deepEqual(await assignToMe(local.id, f.deps), {
    ok: false,
    status: 409,
    error: "source cannot assign",
  });
  assert.deepEqual(f.assigned, []);
});

test("the workflow is served from cache inside five minutes and refetched after it or after invalidation", async () => {
  invalidateWorkflow();
  const f = fakeDeps();
  assert.equal((await getWorkflow(f.deps)).ok, true);
  f.tick(299_999);
  await getWorkflow(f.deps);
  assert.equal(f.reads(), 1);
  f.tick(1);
  await getWorkflow(f.deps);
  assert.equal(f.reads(), 2);
  invalidateWorkflow();
  await getWorkflow(f.deps);
  assert.equal(f.reads(), 3);
});

test("a workflow failure answers 502 with the fixed copy and is not cached", async () => {
  invalidateWorkflow();
  const f = fakeDeps(new Error("socket hang up"));
  assert.deepEqual(await getWorkflow(f.deps), {
    ok: false,
    status: 502,
    error: OUTBOUND_COPY.unreachable,
  });
  await getWorkflow(f.deps);
  assert.equal(f.reads(), 2);
});

test("no enabled Linear source answers 409 for the workflow", async () => {
  const f = fakeDeps();
  assert.deepEqual(await getWorkflow({ ...f.deps, source: () => undefined }), {
    ok: false,
    status: 409,
    error: "Linear is not connected",
  });
});
