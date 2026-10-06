import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import type { BoardKey } from "../../shared/types.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../shared/board-key.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { setHooksRuntime } = await import("../services/infra/config-holder.js");
const { registerHookToken } =
  await import("../services/orchestration/hook-tokens.js");
const { hooksRouter } = await import("./hooks.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
const express = (await import("express")).default;

setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });
await store.load();
const created = await store.createLocalCard(
  DEFAULT_BOARD_KEY,
  "hooks-route",
  "",
);
await store.completeStart(created.id, undefined, {
  workspacePath: "/tmp/ws-hooks-route",
  tmuxSession: "dsp-hooks-route-none",
  branch: "hooks-route",
});
const card = store.getCard(created.id)!;
const sessionId = card.activeSessionId!;
const TOKEN = "hooks-route-token-0123456789";
registerHookToken(TOKEN, card.id, sessionId);

const ACME = parseBoardKey("ACME") as BoardKey;
await store.createBoard({
  key: ACME,
  name: "Acme",
  workspaceRoot: "/tmp/acme-sessions",
  repositories: [],
  linearTeamKeys: [],
});
const acmeCreated = await store.createLocalCard(ACME, "hooks-acme", "");
await store.completeStart(acmeCreated.id, undefined, {
  workspacePath: "/tmp/acme-sessions/ACME-1",
  tmuxSession: "dsp-hooks-acme-none",
  branch: "ACME-1",
});
const acmeCard = store.getCard(acmeCreated.id)!;
const ACME_TOKEN = "hooks-acme-token-0123456789";
registerHookToken(ACME_TOKEN, acmeCard.id, acmeCard.activeSessionId!);

const app = express();
app.use("/api", express.json(), hooksRouter);
app.use(httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/hook/claude`;
after(() => {
  server.close();
  env.cleanup();
});

function post(token: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dispatch-token": token },
    body: JSON.stringify(body),
  });
}

test("valid token with extra body keys answers 204 empty and applies the event", async () => {
  assert.equal(store.getCard(card.id)!.claudeSessionId, undefined);

  const res = await post(TOKEN, {
    hook_event_name: "UserPromptSubmit",
    session_id: "conv-a",
    prompt: "hi",
    transcript_path: "/t",
    nested: { a: [1, 2] },
  });

  assert.equal(res.status, 204);
  assert.equal(await res.text(), "");
  const after = store.getCard(card.id)!;
  assert.equal(after.claudeSessionId, "conv-a");
  assert.deepEqual(
    after
      .sessions!.find((s) => s.id === sessionId)!
      .claudeSessions!.map((n) => n.id),
    ["conv-a"],
  );
});

test("unknown token answers 401 invalid hook token", async () => {
  const res = await post("no-such-token", { extra: 1 });

  assert.equal(res.status, 401);
  assert.equal(await res.text(), '{"error":"invalid hook token"}');
});

test("a hook call for a card on a second board updates that card", async () => {
  assert.equal(acmeCard.boardKey, ACME);
  assert.equal(store.getCard(acmeCard.id)!.claudeSessionId, undefined);

  const res = await post(ACME_TOKEN, {
    hook_event_name: "UserPromptSubmit",
    session_id: "conv-acme",
    prompt: "hi",
  });

  assert.equal(res.status, 204);
  assert.equal(store.getCard(acmeCard.id)!.claudeSessionId, "conv-acme");
  assert.equal(store.getCard(card.id)!.claudeSessionId, "conv-a");
});

const DONE_MESSAGE = "work finished\nDISPATCH_STATUS: DONE - shipped";

test("a Stop hook with a wrong token, or with the token of another board's card, never moves an ACME card", async () => {
  assert.equal(store.getCard(acmeCard.id)!.column, "in_progress");
  const claimed = {
    hook_event_name: "Stop",
    last_assistant_message: DONE_MESSAGE,
    session_id: acmeCard.activeSessionId,
    card_id: acmeCard.id,
  };

  const wrong = await post("not-the-acme-token", claimed);
  assert.equal(wrong.status, 401);
  assert.equal(await wrong.text(), '{"error":"invalid hook token"}');
  assert.equal(store.getCard(acmeCard.id)!.column, "in_progress");

  const local = await post(TOKEN, claimed);
  assert.equal(local.status, 204);
  assert.equal(store.getCard(card.id)!.column, "agent_done");
  assert.equal(store.getCard(acmeCard.id)!.column, "in_progress");
});

test("a Stop hook with the token of an ACME card moves that card and no card of LOCAL", async () => {
  const localColumn = store.getCard(card.id)!.column;
  const res = await post(ACME_TOKEN, {
    hook_event_name: "Stop",
    last_assistant_message: DONE_MESSAGE,
  });

  assert.equal(res.status, 204);
  const moved = store.getCard(acmeCard.id)!;
  assert.equal(moved.column, "agent_done");
  assert.equal(moved.boardKey, ACME);
  assert.equal(store.getCard(card.id)!.column, localColumn);
});
