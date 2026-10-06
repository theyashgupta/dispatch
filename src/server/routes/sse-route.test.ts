import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type {
  ActivityEvent,
  BoardKey,
  BoardSnapshot,
  EventType,
  TunnelState,
} from "../../shared/types.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../shared/board-key.js";
import { DONE_PAGE_SIZE } from "../../shared/done-limit.js";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";
import { startedGroup } from "../test-support/group-fixtures.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { sseRouter } = await import("./sse.route.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { tunnelEmitter } = await import("../services/orchestration/tunnel.js");
const { unwindGroup } = await import("../services/orchestration/unwind.js");

function key(value: string): BoardKey {
  const parsed = parseBoardKey(value);
  assert.ok(parsed, value);
  return parsed;
}

const ACME = key("ACME");
const BETA = key("BETA");
const LOCAL = DEFAULT_BOARD_KEY;

setOrchestrationConfig({ linearApiKey: "" });
await store.load();
for (const [board, name] of [
  [ACME, "Acme"],
  [BETA, "Beta"],
] as const) {
  await store.createBoard({
    key: board,
    name,
    workspaceRoot: null,
    repositories: [],
    linearTeamKeys: [],
  });
}
await store.setBoardArchived(BETA, true);

const localCard = await store.createLocalCard(LOCAL, "stream local", "");
const acmeCard = await store.createLocalCard(ACME, "stream acme", "");

const app = express();
app.use("/api", sseRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

const open: AbortController[] = [];

after(() => {
  for (const c of open) c.abort();
  server.close();
  server.closeAllConnections();
  env.cleanup();
});

interface Stream {
  status: number;
  text(): string;
  frames(): string[];
  snapshots(): BoardSnapshot[];
  until(probe: () => boolean, label: string): Promise<void>;
}

async function connect(query = ""): Promise<Stream> {
  const controller = new AbortController();
  open.push(controller);
  const res = await fetch(`${base}/stream${query}`, {
    signal: controller.signal,
  });
  let text = "";
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        text += decoder.decode(value, { stream: true });
      }
    } catch {
      return;
    }
  })();
  const frames = () => text.split("\n\n").filter((f) => f !== "");
  const stream: Stream = {
    status: res.status,
    text: () => text,
    frames,
    snapshots: () =>
      frames()
        .filter((f) => f.startsWith("data: {"))
        .map((f) => JSON.parse(f.slice("data: ".length)) as BoardSnapshot),
    until: (probe, label) =>
      waitFor(() => Promise.resolve(probe()), 3000, label),
  };
  await stream.until(() => stream.snapshots().length > 0, "first frame");
  return stream;
}

function cardIds(stream: Stream, index = 0): string[] {
  return stream.snapshots()[index].cards.map((c) => c.id);
}

test("two clients on two boards get disjoint snapshots", async () => {
  const local = await connect("?board=LOCAL");
  const acme = await connect("?board=ACME");
  assert.ok(cardIds(local).includes(localCard.id));
  assert.ok(!cardIds(local).includes(acmeCard.id));
  assert.ok(cardIds(acme).includes(acmeCard.id));
  assert.ok(!cardIds(acme).includes(localCard.id));
});

test("an activity of ACME reaches only the ACME client", async () => {
  const local = await connect("?board=LOCAL");
  const acme = await connect("?board=ACME");
  const created = await store.createLocalCard(ACME, "stream acme live", "");
  await acme.until(
    () =>
      acme.text().includes(`event: activity\ndata: {`) &&
      acme.text().includes(created.id),
    "ACME activity",
  );
  const own = await store.createLocalCard(LOCAL, "stream local live", "");
  await local.until(() => local.text().includes(own.id), "LOCAL activity");
  assert.ok(!local.text().includes(created.id));
  assert.ok(acme.text().includes(created.id));
  assert.ok(!acme.text().includes(own.id));
  const activities = (s: Stream) =>
    s.frames().filter((f) => f.startsWith("event: activity"));
  assert.ok(activities(local).length > 0);
  assert.ok(activities(local).every((f) => f.includes('"boardKey":"LOCAL"')));
  assert.ok(activities(acme).every((f) => f.includes('"boardKey":"ACME"')));
});

for (const [name, query] of [
  ["an unknown board", "?board=ZZZZ"],
  ["a malformed board", "?board=acme%21"],
  ["a repeated board", "?board=ACME&board=LOCAL"],
  ["an archived board", "?board=BETA"],
] as const) {
  test(`${name} falls back to LOCAL with no 4xx`, async () => {
    const stream = await connect(query);
    assert.equal(stream.status, 200);
    assert.ok(cardIds(stream).includes(localCard.id));
    assert.ok(!cardIds(stream).includes(acmeCard.id));
    assert.ok(stream.text().includes("event: tunnel"));
    const created = await store.createLocalCard(LOCAL, "fallback live", "");
    await stream.until(() => stream.text().includes(created.id), "LOCAL feed");
    await store.createLocalCard(ACME, "fallback acme live", "");
    await store.createLocalCard(LOCAL, "fallback tail", "");
    await stream.until(
      () => stream.text().includes("fallback tail"),
      "LOCAL tail",
    );
    assert.ok(!stream.text().includes("fallback acme live"));
  });
}

test("two clients on one board and one window share one serialized frame", async (t) => {
  const first = await connect(`?board=ACME&doneLimit=5`);
  const second = await connect(`?board=ACME&doneLimit=5`);
  const wider = await connect(`?board=ACME&doneLimit=7`);
  const local = await connect(`?board=LOCAL&doneLimit=5`);
  const all = [first, second, wider, local];
  const before = all.map((s) => s.snapshots().length);
  const snapshot = t.mock.method(store, "snapshot");
  await store.createLocalCard(ACME, "shared frame", "");
  await Promise.all(
    all.map((s, i) =>
      s.until(() => s.snapshots().length > before[i], `frame ${i}`),
    ),
  );
  const calls = snapshot.mock.calls.map((c) => c.arguments);
  const count = (board: BoardKey, doneLimit: number) =>
    calls.filter(([b, o]) => b === board && o?.doneLimit === doneLimit).length;
  assert.equal(count(ACME, 5), 1);
  assert.equal(count(ACME, 7), 1);
  assert.equal(count(LOCAL, 5), 1);
  const lastFrame = (s: Stream) =>
    s
      .frames()
      .filter((f) => f.startsWith("data: {"))
      .at(-1);
  assert.equal(lastFrame(first), lastFrame(second));
  assert.ok(lastFrame(first)!.includes("shared frame"));
  assert.ok(!lastFrame(local)!.includes("shared frame"));
});

test("a client with no board gets the first frame of today", async () => {
  const stream = await connect();
  const expected = `data: ${JSON.stringify(
    store.snapshot(LOCAL, { doneLimit: DONE_PAGE_SIZE }),
  )}\n\n`;
  assert.equal(stream.frames()[0] + "\n\n", expected);
  assert.ok(cardIds(stream).includes(localCard.id));
  assert.ok(!cardIds(stream).includes(acmeCard.id));
});

function activityFrames(stream: Stream): ActivityEvent[] {
  return stream
    .frames()
    .filter((f) => f.startsWith("event: activity\ndata: "))
    .map(
      (f) =>
        JSON.parse(f.slice("event: activity\ndata: ".length)) as ActivityEvent,
    );
}

test("the real mutations of a card on ACME send their activity frames to the ACME client only", async () => {
  const local = await connect("?board=LOCAL");
  const acme = await connect("?board=ACME");
  const card = await store.createLocalCard(ACME, "real mutations", "");
  await store.moveCardManual(card.id, "parked");
  const { g } = await startedGroup(store, { board: ACME });
  assert.equal((await unwindGroup(g.id, "todo")).ok, true);
  await acme.until(
    () => activityFrames(acme).some((e) => e.type === "group_unwound"),
    "ACME group_unwound",
  );
  const own = await store.createLocalCard(LOCAL, "real mutations local", "");
  await local.until(
    () => activityFrames(local).some((e) => e.cardId === own.id),
    "LOCAL tail",
  );
  const types = new Set(activityFrames(acme).map((e) => e.type));
  for (const type of [
    "local_created",
    "move_manual",
    "group_created",
    "session_start",
    "group_unwound",
  ] as const) {
    assert.ok(types.has(type), `ACME client got ${type}`);
  }
  assert.ok(activityFrames(acme).every((e) => e.boardKey === "ACME"));
  assert.deepEqual(
    activityFrames(local).filter((e) => e.boardKey !== "LOCAL"),
    [],
  );
  assert.ok(!local.text().includes("group_unwound"));
});

test("an activity event of every type on ACME reaches no LOCAL client and every ACME client", async () => {
  const everyType: Record<EventType, true> = {
    sync_in: true,
    move_manual: true,
    move_auto: true,
    status_needs_input: true,
    status_agent_done: true,
    status_done: true,
    session_start: true,
    session_resume: true,
    session_lost: true,
    session_failed: true,
    resume_failed: true,
    cleanup: true,
    local_created: true,
    sync_out: true,
    group_created: true,
    group_unwound: true,
    group_restored: true,
    archive_deleted: true,
    session_reset: true,
    item_promoted: true,
    linear_state_pushed: true,
  };
  const local = await connect("?board=LOCAL");
  const acme = await connect("?board=ACME");
  const types = Object.keys(everyType) as EventType[];
  const fromId = 900_000;
  types.forEach((type, i) => {
    store.emit("activity", {
      id: fromId + i,
      cardId: acmeCard.id,
      type,
      fromCol: null,
      toCol: null,
      reason: null,
      source: null,
      ts: new Date().toISOString(),
      boardKey: ACME,
    } satisfies ActivityEvent);
  });
  await acme.until(
    () =>
      activityFrames(acme).filter((e) => e.id >= fromId).length ===
      types.length,
    "every ACME activity",
  );
  assert.deepEqual(
    activityFrames(acme)
      .filter((e) => e.id >= fromId)
      .map((e) => e.type),
    types,
  );
  const tail = await store.createLocalCard(LOCAL, "after every type", "");
  await local.until(
    () => activityFrames(local).some((e) => e.cardId === tail.id),
    "LOCAL tail",
  );
  assert.deepEqual(
    activityFrames(local).filter((e) => e.id >= fromId),
    [],
  );
});

test("a tunnel change frame reaches the clients of both boards", async () => {
  const local = await connect("?board=LOCAL");
  const acme = await connect("?board=ACME");
  const state: TunnelState = {
    status: "on",
    url: "https://tunnel.example.test",
    code: "123456",
  };
  const frame = `event: tunnel\ndata: ${JSON.stringify(state)}`;
  tunnelEmitter.emit("change", state);
  await Promise.all(
    [local, acme].map((s) =>
      s.until(() => s.frames().includes(frame), "tunnel change frame"),
    ),
  );
  assert.equal(local.frames().filter((f) => f === frame).length, 1);
  assert.equal(acme.frames().filter((f) => f === frame).length, 1);
});
