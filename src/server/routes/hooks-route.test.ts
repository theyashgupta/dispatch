import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";

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
const created = await store.createLocalCard("hooks-route", "");
await store.completeStart(created.id, undefined, {
  workspacePath: "/tmp/ws-hooks-route",
  tmuxSession: "dsp-hooks-route-none",
  branch: "hooks-route",
});
const card = store.getCard(created.id)!;
const sessionId = card.activeSessionId!;
const TOKEN = "hooks-route-token-0123456789";
registerHookToken(TOKEN, card.id, sessionId);

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

test("UserPromptSubmit, Stop and StopFailure posts reach the turn state with the error field", async () => {
  const { recordedTurnState } =
    await import("../services/orchestration/session-turn.js");
  await post(TOKEN, { hook_event_name: "UserPromptSubmit" });
  assert.equal(recordedTurnState(card.id, sessionId), "busy");
  await post(TOKEN, { hook_event_name: "Stop", last_assistant_message: "ok" });
  assert.equal(recordedTurnState(card.id, sessionId), "idle");
  const res = await post(TOKEN, {
    hook_event_name: "StopFailure",
    error: "rate_limit",
  });
  assert.equal(res.status, 204);
  assert.equal(recordedTurnState(card.id, sessionId), "limit");
});
