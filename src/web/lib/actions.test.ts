import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INBOX_ACTIONS,
  actionsFor,
  isWebUrl,
  CARD_ACTIONS,
  bulkOutcomeCopy,
  runAction,
  runBulkCleanup,
  runBulkResume,
  snoozeRow,
  syncSources,
  type ActionContext,
  type CardActionContext,
  type InboxRowModel,
} from "./actions.js";

function row(extra: Partial<InboxRowModel> = {}): InboxRowModel {
  return {
    kind: "item",
    id: "fake:a",
    source: "fake",
    title: "Review PR 42",
    snippet: "",
    priority: 80,
    time: "2026-09-24T10:00:00.000Z",
    unread: true,
    url: "https://example.test/pr/42",
    ...extra,
  };
}

function ctx() {
  const calls: string[] = [];
  let undo: (() => Promise<void>) | null = null;
  const context: ActionContext = {
    api: {
      promoteItem: async (id) => {
        calls.push(`promote ${id}`);
        return await Promise.resolve({ card: {} as never });
      },
      setItemState: async (id, state) => {
        calls.push(`state ${id} ${state}`);
        await Promise.resolve();
      },
      snoozeItem: async (id, until) => {
        calls.push(`snooze ${id} ${until}`);
        await Promise.resolve();
      },
      moveCard: async (id, column) => {
        calls.push(`move ${id} ${column}`);
        await Promise.resolve();
      },
      cleanupCard: async (id) => {
        calls.push(`cleanup ${id}`);
        await Promise.resolve();
      },
      switchSession: async (id, sessionId) => {
        calls.push(`switch ${id} ${sessionId}`);
        await Promise.resolve();
      },
      resumeCard: async (id) => {
        calls.push(`resume ${id}`);
        return await Promise.resolve({ ok: true as const });
      },
      pollSource: async (id) => {
        calls.push(`poll ${id}`);
        if (id === "bad") throw new Error("409");
        await Promise.resolve();
      },
    },
    showUndo: (label, u) => {
      calls.push(`undo-toast ${label}`);
      undo = u;
    },
    notice: (text) => calls.push(`notice ${text}`),
    openSnooze: (r) => calls.push(`snooze-picker ${r.id}`),
    openUrl: (url) => calls.push(`open ${url}`),
    copyText: async (text) => {
      calls.push(`copy ${text}`);
      await Promise.resolve();
    },
  };
  return { context, calls, undo: () => undo };
}

const action = (id: string) => {
  const a = INBOX_ACTIONS.find((x) => x.id === id);
  assert.ok(a, id);
  return a;
};

test("appliesTo: promote applies to both kinds; snooze, done and toggleRead refuse cards; open and copy need a url", () => {
  const item = row();
  const card = row({ kind: "card", id: "LIN-1" });
  const bare = row({ url: undefined });
  assert.deepEqual(
    actionsFor(item).map((a) => a.id),
    ["promote", "snooze", "done", "toggleRead", "open", "copyLink"],
  );
  assert.deepEqual(
    actionsFor(card).map((a) => a.id),
    ["promote", "open", "copyLink"],
  );
  assert.deepEqual(
    actionsFor(bare).map((a) => a.id),
    ["promote", "snooze", "done", "toggleRead"],
  );
});

test("promote on an item calls the promote api once; on a card it moves the card to todo", async () => {
  const c = ctx();
  await runAction(action("promote"), c.context, row());
  await runAction(
    action("promote"),
    c.context,
    row({ kind: "card", id: "LIN-1" }),
  );
  assert.deepEqual(c.calls, ["promote fake:a", "move LIN-1 todo"]);
});

test("done sets state done, offers undo, and undo restores unread", async () => {
  const c = ctx();
  await runAction(action("done"), c.context, row());
  assert.deepEqual(c.calls, [
    "state fake:a done",
    "undo-toast Review PR 42 marked done",
  ]);
  await c.undo()?.();
  assert.equal(c.calls.at(-1), "state fake:a unread");
});

test("toggleRead toggles, snooze opens the picker, open and copy use the url", async () => {
  const c = ctx();
  await runAction(action("toggleRead"), c.context, row());
  await runAction(action("toggleRead"), c.context, row({ unread: false }));
  await runAction(action("snooze"), c.context, row());
  await runAction(action("open"), c.context, row());
  await runAction(action("copyLink"), c.context, row());
  assert.deepEqual(c.calls, [
    "state fake:a read",
    "state fake:a unread",
    "snooze-picker fake:a",
    "open https://example.test/pr/42",
    "copy https://example.test/pr/42",
    "notice Link copied",
  ]);
});

test("snooze never runs on a card, and a refused api call becomes a notice", async () => {
  const c = ctx();
  await runAction(
    action("snooze"),
    c.context,
    row({ kind: "card", id: "LIN-1" }),
  );
  assert.deepEqual(c.calls, []);
  c.context.api.setItemState = () =>
    Promise.reject(new Error("item is promoted"));
  await runAction(action("toggleRead"), c.context, row());
  assert.deepEqual(c.calls, ["notice item is promoted"]);
});

test("snoozeRow snoozes an item to the preset time, offers undo, and skips a card", async () => {
  const c = ctx();
  const now = new Date(2026, 8, 22, 14, 30);
  await snoozeRow(c.context, row(), "1h", now);
  const until = new Date(now.getTime() + 3_600_000).toISOString();
  assert.deepEqual(c.calls, [
    `snooze fake:a ${until}`,
    "undo-toast Review PR 42 snoozed for 1 hour",
  ]);
  await c.undo()?.();
  assert.equal(c.calls.at(-1), "state fake:a unread");
  await snoozeRow(c.context, row({ kind: "card", id: "LIN-1" }), "1h", now);
  assert.equal(c.calls.length, 3);
});

test("undo after done restores the state the row had, read stays read", async () => {
  const c = ctx();
  await runAction(action("done"), c.context, row({ unread: false }));
  await c.undo()?.();
  assert.equal(c.calls.at(-1), "state fake:a read");
});

test("only http and https urls qualify for Open link and Copy link", async () => {
  assert.equal(isWebUrl("https://example.test/pr/1"), true);
  assert.equal(isWebUrl("http://example.test"), true);
  for (const bad of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "not a url",
    undefined,
  ]) {
    assert.equal(isWebUrl(bad), false, String(bad));
  }
  const c = ctx();
  const hostile = row({ url: "javascript:alert(1)" });
  assert.deepEqual(
    actionsFor(hostile).map((a) => a.id),
    ["promote", "snooze", "done", "toggleRead"],
  );
  await runAction(action("open"), c.context, hostile);
  await runAction(action("copyLink"), c.context, hostile);
  assert.deepEqual(c.calls, []);
});

test("a preset that resolves to the past becomes a notice, never an unhandled throw", async () => {
  const c = ctx();
  await snoozeRow(c.context, row(), "bogus" as never, new Date());
  assert.equal(c.calls.length, 1);
  assert.match(c.calls[0] ?? "", /^notice /);
});

const target = (cardId: string, sessionId: string) => ({
  cardId,
  identifier: cardId,
  sessionId,
});

test("bulk cleanup calls each distinct card once, in order, and keeps going past a failure", async () => {
  const c = ctx();
  const outcome = await runBulkCleanup(c.context.api, [
    target("LOCAL-1", "a"),
    target("LOCAL-1", "b"),
    target("LOCAL-2", "c"),
  ]);
  assert.deepEqual(c.calls, ["cleanup LOCAL-1", "cleanup LOCAL-2"]);
  assert.deepEqual(outcome, { done: ["LOCAL-1", "LOCAL-2"], failed: [] });
  const failing = ctx();
  failing.context.api.cleanupCard = async (id) => {
    failing.calls.push(`cleanup ${id}`);
    if (id === "LOCAL-1") throw new Error("cleanupCard failed: 409");
    await Promise.resolve();
  };
  const mixed = await runBulkCleanup(failing.context.api, [
    target("LOCAL-1", "a"),
    target("LOCAL-2", "c"),
  ]);
  assert.deepEqual(failing.calls, ["cleanup LOCAL-1", "cleanup LOCAL-2"]);
  assert.deepEqual(mixed, {
    done: ["LOCAL-2"],
    failed: [{ identifier: "LOCAL-1", error: "cleanupCard failed: 409" }],
  });
  assert.equal(
    bulkOutcomeCopy("Cleaned up", mixed),
    "Cleaned up 1 of 2. Failed: LOCAL-1 (cleanupCard failed: 409)",
  );
});

test("bulk resume switches then resumes per card and reports a refused resume by identifier", async () => {
  const c = ctx();
  c.context.api.resumeCard = async (id) => {
    c.calls.push(`resume ${id}`);
    return await Promise.resolve(
      id === "LOCAL-2"
        ? { ok: false as const, status: 400 }
        : { ok: true as const },
    );
  };
  const outcome = await runBulkResume(c.context.api, [
    target("LOCAL-1", "s1"),
    target("LOCAL-2", "s2"),
  ]);
  assert.deepEqual(c.calls, [
    "switch LOCAL-1 s1",
    "resume LOCAL-1",
    "switch LOCAL-2 s2",
    "resume LOCAL-2",
  ]);
  assert.deepEqual(outcome, {
    done: ["LOCAL-1"],
    failed: [{ identifier: "LOCAL-2", error: "resume refused (400)" }],
  });
  assert.equal(
    bulkOutcomeCopy("Resumed", { done: ["a"], failed: [] }),
    "Resumed 1 of 1",
  );
});

test("bulk resume skips the switch for an active row and switches back after a refused resume", async () => {
  const c = ctx();
  c.context.api.resumeCard = async (id) => {
    c.calls.push(`resume ${id}`);
    return await Promise.resolve(
      id === "LOCAL-2"
        ? { ok: false as const, status: 409 }
        : { ok: true as const },
    );
  };
  await runBulkResume(c.context.api, [
    { ...target("LOCAL-1", "s1"), active: true },
    { ...target("LOCAL-2", "lost"), active: false, restoreSessionId: "live" },
  ]);
  assert.deepEqual(c.calls, [
    "resume LOCAL-1",
    "switch LOCAL-2 lost",
    "resume LOCAL-2",
    "switch LOCAL-2 live",
  ]);
});

test("each card action calls its handler once with the card id", async () => {
  const calls: string[] = [];
  const cardCtx: CardActionContext = {
    api: {
      moveCard: async (id, column) => {
        calls.push(`move ${id} ${column}`);
        await Promise.resolve();
      },
    },
    requestStart: (id) => calls.push(`start ${id}`),
    requestCleanup: (id) => calls.push(`cleanup ${id}`),
    openCard: (id) => calls.push(`open ${id}`),
  };
  const card = { id: "LOCAL-7" } as Parameters<typeof CARD_ACTIONS.start>[1];
  CARD_ACTIONS.start(cardCtx, card);
  CARD_ACTIONS.openTerminal(cardCtx, card);
  await CARD_ACTIONS.moveTo(cardCtx, card, "parked");
  CARD_ACTIONS.cleanup(cardCtx, card);
  assert.deepEqual(calls, [
    "start LOCAL-7",
    "open LOCAL-7",
    "move LOCAL-7 parked",
    "cleanup LOCAL-7",
  ]);
});

test("Sync now posts nothing with no enabled source and names a refused source", async () => {
  const none = ctx();
  await syncSources(none.context.api, [], none.context.notice);
  assert.deepEqual(none.calls, ["notice No source is enabled"]);
  const some = ctx();
  await syncSources(some.context.api, ["linear", "bad"], some.context.notice);
  assert.deepEqual(some.calls, [
    "notice Syncing linear, bad",
    "poll linear",
    "poll bad",
    "notice Sync refused: bad",
  ]);
});
