import test, { after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { isolateEnv } from "../test-support/fixtures.js";
import type {
  SupervisorState,
  SupervisorStateReason,
} from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { resolveBinaryPath } = await import("../adapters/resolve-binary.js");
const { stopPollers } = await import("../adapters/poller.js");
const express = (await import("express")).default;
const { apiRouter } = await import("./index.js");
const { sessionTools } =
  await import("../services/orchestration/orchestrator-sessions.js");
const { sendConfirmed } =
  await import("../services/orchestration/supervisor-send.js");
const { SBX, setupSupervisedBoard, startSupervised, stopSupervisedTmux } =
  await import("../test-support/supervised-session.js");
const hasTmux = (await resolveBinaryPath("tmux")) !== null;

const FAST = { readyMs: 2_000, settleMs: 300, confirmMs: 1_500, pollMs: 100 };

await setupSupervisedBoard();
sessionTools.send = (card, session, text, kind) =>
  sendConfirmed(card, session, text, kind, FAST);

const app = express();
app.use("/api", express.json(), apiRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(async () => {
  server.close();
  stopPollers();
  await stopSupervisedTmux();
  env.cleanup();
});

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

async function call(
  route: string,
  body?: unknown,
  token?: string,
): Promise<Reply> {
  const res = await fetch(`${base}${route}`, {
    method: "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token === undefined ? {} : { "x-orchestrator-token": token }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
  };
}

const minted = await call("/boards/SBX/orchestrators/orc-sbx/token");
const TOKEN = minted.body.token as string;

const start = (title: string, opts: Record<string, unknown> = {}) =>
  startSupervised({
    tmpRoot: env.root,
    title,
    ...opts,
    scenario: { logAllKeys: true, ...(opts.scenario as object) },
  });

type Supervised = Awaited<ReturnType<typeof start>>;

async function setState(
  s: Supervised,
  state: SupervisorState,
  reason?: SupervisorStateReason,
): Promise<void> {
  await store.setSessionStateIfSession(
    s.card().id,
    s.session().id,
    state,
    reason,
  );
}

/** Assert a refused call and that it sent no key and changed no state. */
async function refused(
  s: Supervised,
  route: string,
  body: unknown,
  status: number,
  error: string,
  token?: string,
): Promise<void> {
  const keys = s.keys().length;
  const before = s.session();
  const reply = await call(route, body, token);
  assert.equal(reply.status, status, JSON.stringify(reply.body));
  assert.equal(reply.body.error, error, route);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(s.keys().length, keys, `${route} sent a key`);
  assert.equal(s.session().state, before.state);
  assert.equal(s.session().stateReason, before.stateReason);
}

const KEYLESS: SupervisorState[] = [
  "permission_prompt",
  "usage_limit_dialog",
  "usage_limit_wait",
  "shell_prompt",
];

void test(
  "the inline reply answers confirmed when the transcript holds the line",
  { skip: !hasTmux },
  async () => {
    const s = await start("reply-ok");
    const reply = await call(`/sessions/${s.card().id}/input`, {
      text: "use the second option",
    });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.deepEqual(reply.body, { result: "confirmed" });
    assert.deepEqual(s.userTexts(), ["use the second option"]);
  },
);

void test(
  "the inline reply answers unconfirmed when the line never reaches the transcript",
  { skip: !hasTmux },
  async () => {
    const s = await start("reply-lost", {
      scenario: { transcriptPath: path.join(env.root, "elsewhere.jsonl") },
    });
    const reply = await call(`/sessions/${s.card().id}/input`, {
      text: "hello",
    });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { result: "unconfirmed" });
    assert.deepEqual(s.userTexts(), []);
    const sends = s.actions().filter((e) => e.data.action === "send");
    assert.deepEqual(
      sends.map((e) => [e.data.kind, e.data.result]),
      [["user_input", "unconfirmed"]],
    );
  },
);

void test(
  "the inline reply is refused in the four keyless states and for a bad text",
  { skip: !hasTmux },
  async () => {
    const s = await start("reply-refused");
    const route = `/sessions/${s.card().id}/input`;
    for (const state of KEYLESS) {
      await setState(s, state);
      await refused(s, route, { text: "x" }, 409, "session-state-refused");
    }
    await setState(s, "working");
    for (const text of ["", "   ", "! rm", "/clear", "#note", "&x", "@file"]) {
      await refused(s, route, { text }, 400, "invalid-text");
    }
    await refused(s, route, { text: "x", extra: 1 }, 400, "unknown-field");
    assert.deepEqual(s.userTexts(), []);
  },
);

void test(
  "the inline reply reaches a loop that stopped on budget or usage",
  { skip: !hasTmux },
  async () => {
    const s = await start("reply-stopped");
    const route = `/sessions/${s.card().id}/input`;
    let n = 0;
    for (const reason of ["budget", "usage_stop"] as const) {
      await setState(s, "needs_input", reason);
      const reply = await call(route, { text: `answer ${++n}` });
      assert.equal(reply.status, 200, JSON.stringify(reply.body));
      assert.deepEqual(reply.body, { result: "confirmed" });
    }
    assert.deepEqual(s.userTexts(), ["answer 1", "answer 2"]);
  },
);

void test(
  "the inline reply reaches the hidden card of an orchestrator",
  { skip: !hasTmux },
  async () => {
    const s = await start("reply-orch", { orchestrator: "main" });
    const reply = await call(`/sessions/${s.card().id}/input`, {
      text: "plan the intake",
    });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.deepEqual(reply.body, { result: "confirmed" });
    assert.deepEqual(s.userTexts(), ["plan the intake"]);
    await refused(
      s,
      `/sessions/${s.card().id}/input`,
      { text: "/exit" },
      400,
      "invalid-text",
    );
  },
);

void test("a card with no live session is 409 and an unknown card is 404", async () => {
  const card = await store.createLocalCard(SBX, "no session", "");
  for (const route of ["input", "resume-loop"]) {
    const reply = await call(`/sessions/${card.id}/${route}`, { text: "x" });
    assert.equal(reply.status, 409, route);
    assert.equal(reply.body.error, "no-live-session", route);
    const gone = await call(`/sessions/NO-SUCH-1/${route}`, { text: "x" });
    assert.equal(gone.status, 404, route);
    assert.equal(gone.body.error, "unknown-card", route);
  }
});

void test(
  "a second reply on the same card while one runs is 409 session-busy",
  { skip: !hasTmux },
  async () => {
    const s = await start("reply-busy");
    const route = `/sessions/${s.card().id}/input`;
    const replies = await Promise.all([
      call(route, { text: "first answer" }),
      call(route, { text: "second answer" }),
    ]);
    assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      replies.find((r) => r.status === 409)?.body.error,
      "session-busy",
    );
  },
);

void test(
  "the user resume continues a loop after a usage stop and after a budget stop",
  { skip: !hasTmux },
  async () => {
    const s = await start("resume-user", { group: true });
    const id = s.card().id;
    const route = `/sessions/${id}/resume-loop`;
    for (const reason of ["usage_stop", "budget", "stop_session"] as const) {
      await setState(s, "needs_input", reason);
      const reply = await call(route);
      assert.equal(reply.status, 200, JSON.stringify(reply.body));
      assert.deepEqual(reply.body, { result: "confirmed" });
      assert.equal(s.session().state, "working");
      assert.equal(s.session().stateReason, undefined);
    }
    assert.equal(s.userTexts().length, 3);
    assert.match(s.userTexts()[0] ?? "", /^The session was restarted\./);
    const rows = store
      .listOrchestrationEvents(SBX, 0, 1000)
      .filter((e) => e.cardId === id && e.kind === "supervisor_state");
    assert.equal(rows.at(-1)?.data.evidence, "resume_loop by user");
    assert.equal(rows.at(-1)?.data.to, "working");
  },
);

void test(
  "a user resume whose send is unconfirmed answers unconfirmed and leaves the session stopped",
  { skip: !hasTmux },
  async () => {
    const s = await start("resume-user-lost", {
      group: true,
      scenario: {
        transcriptPath: path.join(env.root, "resume-user-lost.jsonl"),
      },
    });
    const id = s.card().id;
    await setState(s, "needs_input", "usage_stop");
    const column = s.card().column;
    const reply = await call(`/sessions/${id}/resume-loop`);
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.deepEqual(reply.body, { result: "unconfirmed" });
    assert.equal(s.session().state, "needs_input");
    assert.equal(s.session().stateReason, "usage_stop");
    assert.equal(s.card().column, column);
    const events = store
      .listOrchestrationEvents(SBX, 0, 1000)
      .filter((e) => e.cardId === id);
    assert.deepEqual(
      events.filter((e) => e.kind === "supervisor_state"),
      [],
    );
    assert.deepEqual(
      events
        .filter((e) => e.data.action === "send")
        .map((e) => [e.data.kind, e.data.result]),
      [["resume", "unconfirmed"]],
    );
  },
);

void test(
  "the user resume is refused for a session that is not at needs_input",
  { skip: !hasTmux },
  async () => {
    const s = await start("resume-working", { group: true });
    await refused(
      s,
      `/sessions/${s.card().id}/resume-loop`,
      undefined,
      409,
      "not-resumable",
    );
    assert.deepEqual(s.userTexts(), []);
  },
);

void test(
  "both user session routes refuse an orchestrator token and send nothing",
  { skip: !hasTmux },
  async () => {
    const s = await start("reply-token", { group: true });
    await setState(s, "needs_input", "usage_stop");
    const id = s.card().id;
    await refused(
      s,
      `/sessions/${id}/input`,
      { text: "x" },
      403,
      "orchestrator-token-on-user-route",
      TOKEN,
    );
    await refused(
      s,
      `/sessions/${id}/resume-loop`,
      undefined,
      403,
      "orchestrator-token-on-user-route",
      TOKEN,
    );
    assert.deepEqual(s.userTexts(), []);
  },
);

void test("an orchestrator token is refused before the card is read", async () => {
  for (const route of ["input", "resume-loop"]) {
    const reply = await call(
      `/sessions/NO-SUCH-1/${route}`,
      { text: "x" },
      TOKEN,
    );
    assert.equal(reply.status, 403, route);
    assert.equal(reply.body.error, "orchestrator-token-on-user-route", route);
  }
});
