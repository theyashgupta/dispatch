import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isolateEnv } from "../test-support/fixtures.js";
import { materializeLoopFixture } from "../test-support/loop-fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { registerHookToken } =
  await import("../services/orchestration/hook-tokens.js");
const { loopsRouter } = await import("./loops.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
const express = (await import("express")).default;

await store.load();
const members = [
  await store.createLocalCard(DEFAULT_BOARD_KEY, "loops-member-a", ""),
  await store.createLocalCard(DEFAULT_BOARD_KEY, "loops-member-b", ""),
];
const grouped = await store.createGroupCard(
  DEFAULT_BOARD_KEY,
  "loops-group",
  members.map((m) => m.id),
);
assert.ok(grouped.ok);
const loopRoot = materializeLoopFixture("g14-partial");
await store.completeStart(grouped.card.id, undefined, {
  workspacePath: loopRoot,
  tmuxSession: "dsp-loops-group-none",
  branch: "loops-group",
});
const groupCard = store.getCard(grouped.card.id)!;
const GROUP_TOKEN = "loops-group-token-0123456789";
registerHookToken(GROUP_TOKEN, groupCard.id, groupCard.activeSessionId!);

const app = express();
app.use("/api", express.json(), loopsRouter);
app.use(httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/loops/report`;
after(() => {
  server.close();
  rmSync(loopRoot, { recursive: true, force: true });
  env.cleanup();
});

function post(token: string | undefined, body: unknown): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token !== undefined) headers["x-dispatch-token"] = token;
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
}

function rows() {
  return store.listOrchestrationEvents(DEFAULT_BOARD_KEY, 0, 100);
}

async function waitFor<T>(read: () => T | undefined): Promise<T | undefined> {
  const deadline = Date.now() + 2000;
  for (;;) {
    const value = read();
    if (value !== undefined || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const GOOD = { kind: "phase", unit: 2, phase: 5, result: "pass", note: "ok" };

void test("valid group token answers 202, records one loop_gate row and refreshes the progress", async () => {
  const before = rows().length;

  const res = await post(GROUP_TOKEN, GOOD);

  assert.equal(res.status, 202);
  const all = rows();
  assert.equal(all.length, before + 1);
  const row = all[all.length - 1];
  assert.equal(row.kind, "loop_gate");
  assert.equal(row.cardId, groupCard.id);
  assert.equal(row.sessionId, groupCard.activeSessionId);
  assert.deepEqual(row.data, GOOD);
  const progress = await waitFor(
    () => store.getCard(groupCard.id)?.loopProgress,
  );
  assert.equal(progress?.slug, "g13-modules-b");
});

void test("a pass claim no file holds is recorded but the refreshed gate stays not pass", async () => {
  const before = rows().length;
  const engine = join(loopRoot, ".claude/ralph-loop.local.md");
  writeFileSync(
    engine,
    readFileSync(engine, "utf8").replace("iteration: 38", "iteration: 99"),
  );

  const res = await post(GROUP_TOKEN, {
    kind: "phase",
    unit: 2,
    phase: 8,
    result: "pass",
  });

  assert.equal(res.status, 202);
  assert.equal(rows().length, before + 1);
  const progress = await waitFor(() => {
    const stored = store.getCard(groupCard.id)?.loopProgress;
    return stored?.engine?.iteration === 99 ? stored : undefined;
  });
  assert.ok(progress);
  const phase = progress.units
    .find((u) => u.number === 2)
    ?.phases.find((p) => p.number === 8);
  assert.ok(phase);
  assert.notEqual(phase.gate, "pass");
});

void test("a unit report without phase is accepted", async () => {
  const before = rows().length;

  const res = await post(GROUP_TOKEN, {
    kind: "unit",
    unit: 2,
    result: "fail",
  });

  assert.equal(res.status, 202);
  assert.equal(rows().length, before + 1);
});
