import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type { BoardKey } from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { stopPollers } = await import("../adapters/poller.js");
const { mintOrchestratorToken } =
  await import("../services/orchestration/orchestrator-tokens.js");
const express = (await import("express")).default;
const { apiRouter } = await import("./index.js");

const HID = parseBoardKey("HID") as BoardKey;
await store.load();
await store.createBoard({
  key: HID,
  name: "Hidden",
  workspaceRoot: "/hid/sessions",
  repositories: [],
  linearTeamKeys: [],
});

const app = express();
app.use("/api", express.json(), apiRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  stopPollers();
  env.cleanup();
});

async function get(route: string, token?: string): Promise<string> {
  const res = await fetch(`${base}${route}`, {
    headers: token === undefined ? {} : { "x-orchestrator-token": token },
  });
  const text = await res.text();
  assert.equal(res.status, 200, `${route} ${text}`);
  return text;
}

const countsOf = async () =>
  (
    JSON.parse(await get("/boards/counts")) as {
      counts: { key: string; running: number; attention: number }[];
    }
  ).counts.find((c) => c.key === HID);

async function started(id: string): Promise<void> {
  await store.completeStart(id, undefined, {
    workspacePath: `/hid/sessions/${id}`,
    branch: id,
    tmuxSession: `dsp-${id}`,
  });
}

void test("no user or orchestrator list route lists or counts a hidden orchestrator card", async () => {
  const empty = await countsOf();
  const visible = await store.createLocalCard(HID, "zebra visible", "");
  await started(visible.id);
  const hidden = await store.createOrchestratorCard(
    HID,
    "zebra orchestrator",
    "lead",
  );
  await started(hidden.id);
  await store.moveCardManual(hidden.id, "needs_input");
  assert.equal(store.getCard(hidden.id)?.column, "needs_input");
  const token = mintOrchestratorToken({
    boardKey: HID,
    orchestratorId: "lead",
  });
  const named = (id: string) => new RegExp(`"${id}"`);

  for (const [route, auth] of [
    ["/board?board=HID", undefined],
    ["/boards/HID", undefined],
    ["/boards", undefined],
    ["/search?board=HID&q=zebra", undefined],
    ["/cards?board=HID", undefined],
    ["/sessions?board=HID", undefined],
    ["/orchestrator/cards", token],
    ["/orchestrator/sessions", token],
  ] as const) {
    const body = await get(route, auth);
    assert.doesNotMatch(body, named(hidden.id), route);
    if (route !== "/boards" && route !== "/boards/HID")
      assert.match(body, named(visible.id), route);
  }

  const counts = await countsOf();
  assert.equal(counts?.running, (empty?.running ?? 0) + 1);
  assert.equal(counts?.attention, empty?.attention ?? 0);
});
