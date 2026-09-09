import test from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import type { Card } from "../../shared/types.js";

isolateEnv();
const { redactCard } = await import("./board.store.js");

function card(sessions: Card["sessions"], activeSessionId?: string): Card {
  return {
    id: "c1",
    issueId: "c1",
    identifier: "LOCAL-1",
    title: "t",
    description: null,
    priority: 0,
    column: "in_progress",
    updatedAt: "2026-09-02T00:00:00.000Z",
    hookToken: "secret-token",
    activeSessionId,
    sessions,
  };
}

async function seedPersistedCard(
  seeded: Card,
  schemaVersion: number,
): Promise<void> {
  const { openBoardDb } = await import("./board-db.js");
  const db = openBoardDb();
  const { cards: existing, meta } = db.readAll();
  db.persist(
    [...existing.filter((c) => c.id !== seeded.id), seeded],
    {
      syncedAt: meta.syncedAt ?? null,
      workspaceFolders: meta.workspaceFolders ?? [],
      lastUsed: meta.lastUsed ?? null,
      localTicketCounter: meta.localTicketCounter,
      groupTicketCounter: meta.groupTicketCounter,
      schemaVersion,
    },
    [],
  );
}

void test("redactCard surfaces the active session's account and strips secrets", () => {
  const wire = redactCard(
    card(
      [
        {
          id: "s1",
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
          claudeAccountId: "default",
          tmuxSession: "dsp-LOCAL-1",
        },
        {
          id: "s2",
          createdAt: "2026-09-02T00:00:00.000Z",
          updatedAt: "2026-09-02T00:00:00.000Z",
          claudeAccountId: "11111111-1111-4111-8111-111111111111",
          tmuxSession: "dsp-LOCAL-1-2",
        },
      ],
      "s2",
    ),
  );
  assert.equal(wire.claudeAccountId, "11111111-1111-4111-8111-111111111111");
  assert.equal("hookToken" in wire, false);
  assert.equal("sessions" in wire, false);
  assert.deepEqual(
    wire.sessionSummaries?.map((s) => [s.id, s.claudeAccountId]),
    [
      ["s1", "default"],
      ["s2", "11111111-1111-4111-8111-111111111111"],
    ],
  );
  assert.doesNotMatch(JSON.stringify(wire), /secret-token/);
});

void test("redactCard leaves the field absent when no session carries an account", () => {
  const wire = redactCard(
    card([{ id: "s1", createdAt: "x", updatedAt: "x" }], "s1"),
  );
  assert.equal("claudeAccountId" in wire, false);
});

void test("recordResumeFailure carries an account reason into resumeError, else the fixed copy", async () => {
  const { store } = await import("./board.store.js");
  await store.load();
  const created = await store.createLocalCard("resume reason", "");
  await store.recordResumeFailure(
    created.id,
    undefined,
    "Claude account a@example.com has no config directory; re-login from Settings, Accounts",
  );
  assert.equal(
    store.getCard(created.id)?.resumeError,
    "Resume failed: Claude account a@example.com has no config directory; re-login from Settings, Accounts",
  );
  await store.recordResumeFailure(created.id);
  assert.match(
    store.getCard(created.id)?.resumeError ?? "",
    /^Resume failed\. The worktree may be gone/,
  );
});

void test("setClaudeSessionId appends a node per new conversation id and mirrors the latest one", async () => {
  const { store } = await import("./board.store.js");
  await store.load();
  const created = await store.createLocalCard("node history", "");
  await store.completeStart(created.id, undefined, {
    workspacePath: "/tmp/ws-nodes",
    tmuxSession: "dsp-nodes",
    branch: "nodes",
  });
  const session = () => store.getCard(created.id)!.sessions![0];

  await store.setClaudeSessionId(created.id, undefined, "conv-a");
  assert.equal(session().claudeSessions?.length, 1);
  assert.equal(session().claudeSessions?.[0]?.id, "conv-a");
  assert.equal(
    session().claudeSessions?.[0]?.createdAt,
    session().claudeSessions?.[0]?.lastActiveAt,
  );
  assert.equal(session().claudeSessionId, "conv-a");
  assert.equal(store.getCard(created.id)?.claudeSessionId, "conv-a");

  await new Promise((r) => setTimeout(r, 2));
  await store.setClaudeSessionId(created.id, undefined, "conv-b");
  assert.deepEqual(
    session().claudeSessions?.map((n) => n.id),
    ["conv-a", "conv-b"],
  );
  assert.equal(store.getCard(created.id)?.claudeSessionId, "conv-b");

  await new Promise((r) => setTimeout(r, 2));
  await store.setClaudeSessionId(created.id, undefined, "conv-a");
  assert.equal(session().claudeSessions?.length, 2, "no duplicate node");
  assert.equal(
    store.getCard(created.id)?.claudeSessionId,
    "conv-a",
    "a revisited older conversation becomes latest by lastActiveAt",
  );
});

void test("setClaudeSessionId drops a throttled bump on the latest node without persisting or broadcasting", async () => {
  const { store } = await import("./board.store.js");
  await store.load();
  const created = await store.createLocalCard("throttle", "");
  await store.completeStart(created.id, undefined, {
    workspacePath: "/tmp/ws-throttle",
    tmuxSession: "dsp-throttle",
    branch: "throttle",
  });
  await store.setClaudeSessionId(created.id, undefined, "conv-t");
  const before = store.getCard(created.id)!.sessions![0].claudeSessions![0];
  let changes = 0;
  const onChange = () => {
    changes += 1;
  };
  store.on("change", onChange);
  try {
    await store.setClaudeSessionId(created.id, undefined, "conv-t");
  } finally {
    store.off("change", onChange);
  }
  assert.equal(changes, 0, "no broadcast inside the throttle window");
  assert.deepEqual(
    store.getCard(created.id)!.sessions![0].claudeSessions![0],
    before,
  );
});

void test("setClaudeSessionId is a no-op for an unknown card or an unresolvable session", async () => {
  const { store } = await import("./board.store.js");
  await store.load();
  const created = await store.createLocalCard("no session yet", "");
  await store.setClaudeSessionId("nope", undefined, "conv-x");
  await store.setClaudeSessionId(created.id, "ghost", "conv-x");
  await store.setClaudeSessionId(created.id, undefined, "conv-x");
  assert.equal(store.getCard(created.id)?.sessions, undefined);
  assert.equal(store.getCard(created.id)?.claudeSessionId, undefined);
});

void test("markClaudeSessionMissing keeps the node, moves the mirror to the previous node, then to absent", async () => {
  const { store } = await import("./board.store.js");
  await store.load();
  const created = await store.createLocalCard("missing", "");
  await store.completeStart(created.id, undefined, {
    workspacePath: "/tmp/ws-missing",
    tmuxSession: "dsp-missing",
    branch: "missing",
  });
  await store.setClaudeSessionId(created.id, undefined, "conv-1");
  await new Promise((r) => setTimeout(r, 2));
  await store.setClaudeSessionId(created.id, undefined, "conv-2");
  const session = () => store.getCard(created.id)!.sessions![0];

  await store.markClaudeSessionMissing(created.id, undefined, "conv-2");
  assert.equal(session().claudeSessions?.length, 2, "node kept");
  assert.equal(typeof session().claudeSessions?.[1]?.missingAt, "string");
  assert.equal(store.getCard(created.id)?.claudeSessionId, "conv-1");

  const firstStamp = session().claudeSessions?.[1]?.missingAt;
  await store.markClaudeSessionMissing(created.id, undefined, "conv-2");
  assert.equal(session().claudeSessions?.[1]?.missingAt, firstStamp);

  await store.markClaudeSessionMissing(created.id, undefined, "conv-1");
  assert.equal(store.getCard(created.id)?.claudeSessionId, undefined);
  assert.equal(session().claudeSessions?.length, 2);

  const stampsBefore = session().claudeSessions?.map((n) => n.missingAt);
  await store.markClaudeSessionMissing(created.id, undefined, "never-seen");
  await store.markClaudeSessionMissing("nope", undefined, "conv-1");
  await store.markClaudeSessionMissing(created.id, "ghost", "conv-1");
  assert.equal(session().claudeSessions?.length, 2);
  assert.deepEqual(
    session().claudeSessions?.map((n) => n.missingAt),
    stampsBefore,
    "an unknown node, card, or session changes nothing",
  );
});

void test("redactCard never exposes claudeSessions on the wire", () => {
  const wire = redactCard(
    card(
      [
        {
          id: "s1",
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
          claudeSessionId: "conv-a",
          claudeSessions: [
            {
              id: "conv-a",
              createdAt: "2026-09-01T00:00:00.000Z",
              lastActiveAt: "2026-09-01T00:00:00.000Z",
            },
          ],
        },
        { id: "s2", createdAt: "x", updatedAt: "x" },
      ],
      "s1",
    ),
  );
  assert.doesNotMatch(JSON.stringify(wire), /claudeSessions/);
});

void test("boot migration to schema version 2 gives each recorded conversation id one node and keeps the mirror", async () => {
  const { store } = await import("./board.store.js");
  const legacy: Card = {
    ...card(
      [
        {
          id: "s-legacy",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-02T00:00:00.000Z",
          claudeSessionId: "conv-legacy",
          workspacePath: "/tmp/ws-legacy",
        },
        {
          id: "s-bare",
          createdAt: "2026-08-03T00:00:00.000Z",
          updatedAt: "2026-08-03T00:00:00.000Z",
        },
      ],
      "s-legacy",
    ),
    id: "legacy-1",
    issueId: "legacy-1",
    identifier: "LOCAL-77",
    claudeSessionId: "conv-legacy",
    workspacePath: "/tmp/ws-legacy",
  };
  delete (legacy as Partial<Card>).hookToken;
  await seedPersistedCard(legacy, 1);

  await store.load();
  const migrated = store.getCard("legacy-1")!;
  assert.deepEqual(migrated.sessions![0].claudeSessions, [
    {
      id: "conv-legacy",
      createdAt: "2026-08-01T00:00:00.000Z",
      lastActiveAt: "2026-08-02T00:00:00.000Z",
    },
  ]);
  assert.equal(migrated.sessions![1].claudeSessions, undefined);
  assert.equal(migrated.claudeSessionId, "conv-legacy");
  const { openBoardDb } = await import("./board-db.js");
  const afterFirst = openBoardDb().readAll();
  assert.equal(afterFirst.meta.schemaVersion, 2);
  const firstJson = JSON.stringify(
    afterFirst.cards.find((c) => c.id === "legacy-1"),
  );

  await store.load();
  const afterSecond = openBoardDb().readAll();
  assert.equal(
    JSON.stringify(afterSecond.cards.find((c) => c.id === "legacy-1")),
    firstJson,
    "second boot changes nothing",
  );
});

void test("downgrade repair copies an older build's flat conversation id into the record and gives it a node", async () => {
  const { store } = await import("./board.store.js");
  const drifted: Card = {
    ...card(
      [
        {
          id: "s-drift",
          createdAt: "2026-08-05T00:00:00.000Z",
          updatedAt: "2026-08-05T00:00:00.000Z",
          workspacePath: "/tmp/ws-drift",
        },
      ],
      "s-drift",
    ),
    id: "drift-1",
    issueId: "drift-1",
    identifier: "LOCAL-78",
    claudeSessionId: "conv-old-build",
    workspacePath: "/tmp/ws-drift",
  };
  delete (drifted as Partial<Card>).hookToken;
  await seedPersistedCard(drifted, 2);
  await store.load();
  const repaired = store.getCard("drift-1")!;
  assert.equal(repaired.sessions![0].claudeSessionId, "conv-old-build");
  assert.equal(
    repaired.sessions![0].claudeSessions?.map((n) => n.id).join(),
    "conv-old-build",
  );
  assert.equal(repaired.claudeSessionId, "conv-old-build");
});
