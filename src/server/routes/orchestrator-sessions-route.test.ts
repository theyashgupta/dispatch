import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../test-support/fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type {
  BoardKey,
  BoardPolicy,
  DecisionItem,
  ShipFlow,
  SupervisorState,
  SupervisorStateReason,
} from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { resolveBinaryPath } = await import("../adapters/resolve-binary.js");
const express = (await import("express")).default;
const { orchestratorRouter } = await import("./orchestrator.route.js");
const { boardsRouter } = await import("./boards.route.js");
const { sessionTools } =
  await import("../services/orchestration/orchestrator-sessions.js");
const { sendConfirmed } =
  await import("../services/orchestration/supervisor-send.js");
const {
  LOOP_PROGRESS,
  SBX,
  setupSupervisedBoard,
  startSupervised,
  stopSupervisedTmux,
} = await import("../test-support/supervised-session.js");
const hasTmux = (await resolveBinaryPath("tmux")) !== null;

const OTH = parseBoardKey("OTH") as BoardKey;
const FAST = { readyMs: 2_000, settleMs: 300, confirmMs: 1_500, pollMs: 100 };

await setupSupervisedBoard();
await store.createBoard({
  key: OTH,
  name: "Other",
  workspaceRoot: "/oth/sessions",
  repositories: [],
  linearTeamKeys: [],
});
sessionTools.send = (card, session, text, kind) =>
  sendConfirmed(card, session, text, kind, FAST);

const app = express();
app.use("/api/orchestrator", express.json(), orchestratorRouter);
app.use("/api", express.json(), boardsRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(async () => {
  server.close();
  await stopSupervisedTmux();
  env.cleanup();
});

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

async function raw(
  route: string,
  body?: unknown,
  token?: string,
): Promise<Reply> {
  const res = await fetch(`${base}${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
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

const minted = await raw("/boards/SBX/orchestrators/orc-sbx/token");
const TOKEN = minted.body.token as string;
const call = (route: string, body?: unknown) =>
  raw(`/orchestrator${route}`, body, TOKEN);

async function setPolicy(patch: Partial<BoardPolicy>): Promise<void> {
  await store.setBoardPolicy(SBX, { ...store.getBoard(SBX)!.policy, ...patch });
}

type Supervised = Awaited<ReturnType<typeof startSupervised>>;

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
  expected: Record<string, unknown>,
): Promise<void> {
  const keys = s.keys().length;
  const before = s.session();
  const reply = await call(route, body);
  assert.equal(reply.status, status, JSON.stringify(reply.body));
  for (const [k, v] of Object.entries(expected)) {
    assert.equal(reply.body[k], v, `${route} ${k}`);
  }
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(s.keys().length, keys, `${route} sent a key`);
  assert.equal(s.session().state, before.state);
  assert.equal(s.session().stateReason, before.stateReason);
}

const start = (title: string, opts: Record<string, unknown> = {}) =>
  startSupervised({
    tmpRoot: env.root,
    title,
    ...opts,
    scenario: { logAllKeys: true, ...(opts.scenario as object) },
  });

const KEYLESS: SupervisorState[] = [
  "permission_prompt",
  "usage_limit_dialog",
  "usage_limit_wait",
  "shell_prompt",
];

void test(
  "send_input is confirmed when the transcript holds the line",
  { skip: !hasTmux },
  async () => {
    const s = await start("input-ok");
    const reply = await call(`/sessions/${s.card().id}/input`, {
      text: "use the second option",
    });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.deepEqual(reply.body, { result: "confirmed" });
    assert.deepEqual(s.userTexts(), ["use the second option"]);
  },
);

void test(
  "send_input accepts a markdown bullet text and types it as written",
  { skip: !hasTmux },
  async () => {
    const s = await start("input-bullet");
    const reply = await call(`/sessions/${s.card().id}/input`, {
      text: "- use the second option",
    });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.deepEqual(reply.body, { result: "confirmed" });
    assert.deepEqual(s.userTexts(), ["- use the second option"]);
  },
);

void test(
  "send_input is unconfirmed when the line never reaches the transcript",
  { skip: !hasTmux },
  async () => {
    const s = await start("input-lost", {
      scenario: { transcriptPath: path.join(env.root, "elsewhere.jsonl") },
    });
    const reply = await call(`/sessions/${s.card().id}/input`, {
      text: "hello",
    });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { result: "unconfirmed" });
    assert.deepEqual(s.userTexts(), []);
  },
);

void test(
  "send_input is refused in each keyless state, after a user stop and over budget",
  { skip: !hasTmux },
  async () => {
    const s = await start("input-refused");
    const route = `/sessions/${s.card().id}/input`;
    for (const state of KEYLESS) {
      await setState(s, state);
      await refused(s, route, { text: "x" }, 409, {
        error: "session-state-refused",
        reason: `session is at ${state}`,
      });
    }
    for (const reason of ["budget", "usage_stop"] as const) {
      await setState(s, "needs_input", reason);
      await refused(s, route, { text: "x" }, 403, {
        error: "policy-refused",
        reason: "user must resume",
      });
    }
    await setState(s, "working");
    await store.setSessionMetersIfSession(s.card().id, s.name, {
      contextPercent: 10,
      model: "m",
      cost: 2,
      usage: { fiveHourPercent: null, sevenDayPercent: null },
    });
    await setPolicy({ budgetPerGroup: 1 });
    try {
      await refused(s, route, { text: "x" }, 403, {
        error: "policy-refused",
        reason: "budget reached: cost 2 of 1",
      });
    } finally {
      await setPolicy({ budgetPerGroup: null });
    }
    await refused(s, route, { text: "" }, 400, { error: "invalid-text" });
    assert.deepEqual(s.userTexts(), []);
  },
);

void test("a card with no live session is 409 no-live-session", async () => {
  const card = await store.createLocalCard(SBX, "no session", "");
  const reply = await call(`/sessions/${card.id}/input`, { text: "x" });
  assert.equal(reply.status, 409);
  assert.equal(reply.body.error, "no-live-session");
});

void test(
  "approve_roadmap follows the approval level",
  { skip: !hasTmux },
  async () => {
    const s = await start("approve", { group: true });
    const id = s.card().id;
    const route = `/groups/${id}/approve-roadmap`;
    const line =
      "Roadmap approved (decisions dec-1, dec-2). Continue the loop.";
    await setPolicy({ roadmapApproval: "all" });
    const allowed = await call(route, { decisionIds: ["dec-1", "dec-2"] });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
    assert.deepEqual(allowed.body, { result: "confirmed" });
    assert.deepEqual(s.userTexts(), [line]);

    await setPolicy({ roadmapApproval: "ask" });
    const askRefusal = {
      error: "policy-refused",
      reason: "roadmap approval needs an answered approve item from the user",
    };
    const body = { decisionIds: ["dec-1", "dec-2"] };
    await refused(s, route, body, 403, askRefusal);
    const item = (itemId: string): DecisionItem => ({
      id: itemId,
      boardKey: SBX,
      cardId: id,
      orchestratorId: "orc-sbx",
      kind: "roadmap_approval",
      question: "Approve?",
      options: [
        { id: "approve", label: "Approve" },
        { id: "reject", label: "Reject" },
      ],
      recommendedOptionId: "approve",
      state: "open",
      answer: null,
      createdAt: new Date().toISOString(),
      answeredAt: null,
    });
    store.insertDecisionItem(item("dec-open"));
    await refused(s, route, body, 403, askRefusal);
    store.insertDecisionItem(item("dec-reject"));
    assert.ok(
      store.answerDecisionItem("dec-reject", {
        optionId: "reject",
        note: null,
      }),
    );
    await refused(s, route, body, 403, askRefusal);
    store.insertDecisionItem(item("dec-approve"));
    assert.ok(
      store.answerDecisionItem("dec-approve", {
        optionId: "approve",
        note: null,
      }),
    );
    await refused(s, route, body, 403, askRefusal);
    await refused(s, route, { decisionIds: ["dec-reject"] }, 403, askRefusal);
    const approved = await call(route, {
      decisionIds: ["dec-1", "dec-approve"],
    });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.deepEqual(approved.body, { result: "confirmed" });
    assert.deepEqual(s.userTexts(), [
      line,
      "Roadmap approved (decisions dec-1, dec-approve). Continue the loop.",
    ]);
    assert.ok(store.getDecisionItem("dec-approve")?.consumedAt);
    await refused(s, route, { decisionIds: ["dec-approve"] }, 403, askRefusal);

    await setState(s, "permission_prompt");
    await refused(s, route, body, 409, { error: "session-state-refused" });
    await refused(s, route, { decisionIds: ["bad id"] }, 400, {
      error: "invalid-decision-ids",
    });
    await setPolicy({ roadmapApproval: "all" });
  },
);

void test(
  "request_handoff sends the handoff request and records its row",
  { skip: !hasTmux },
  async () => {
    const s = await start("handoff", { group: true });
    const reply = await call(`/sessions/${s.card().id}/handoff`, {});
    assert.equal(reply.status, 202, JSON.stringify(reply.body));
    assert.deepEqual(reply.body, { result: "confirmed" });
    const [sent] = s.userTexts();
    const file = /^Read (\S+) and follow it\.$/.exec(sent ?? "")?.[1] ?? "";
    assert.ok(file?.endsWith("-handoff.md"), sent);
    assert.match(fs.readFileSync(file, "utf8"), /^Context handoff request\./);
    const rows = s.actions().filter((e) => e.data.action === "handoff_request");
    assert.deepEqual(
      rows.map((e) => e.data),
      [{ action: "handoff_request", hard: false, result: "confirmed" }],
    );
    await setState(s, "usage_limit_dialog");
    await refused(s, `/sessions/${s.card().id}/handoff`, {}, 409, {
      error: "session-state-refused",
    });
  },
);

void test(
  "stop_session sends one Escape and resume_loop continues the loop under the cap",
  { skip: !hasTmux },
  async () => {
    const other = await start("cap-other", { group: true });
    const s = await start("stop", { group: true });
    const id = s.card().id;
    await setState(s, "permission_prompt");
    await refused(s, `/sessions/${id}/stop`, undefined, 409, {
      error: "session-state-refused",
      reason: "session is at permission_prompt",
    });
    await setState(s, "working");
    await refused(s, `/sessions/${id}/resume`, undefined, 409, {
      error: "not-resumable",
    });

    const stopped = await call(`/sessions/${id}/stop`);
    assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
    assert.deepEqual(stopped.body, { stopped: true });
    const keys = await s.keysSettled(1);
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(
      s.keys().map((k) => k.key),
      ["esc"],
    );
    assert.equal(keys.length, 1);
    assert.equal(s.session().state, "needs_input");
    assert.equal(s.session().stateReason, "stop_session");
    assert.equal(s.card().column, "needs_input");

    const others = store
      .listCards(SBX)
      .filter((c) => c.source === "group" && c.id !== id && c.tmuxSession)
      .map((c) => c.id);
    assert.ok(others.includes(other.card().id));
    await setPolicy({ concurrencyCap: others.length });
    await refused(s, `/sessions/${id}/resume`, undefined, 403, {
      error: "policy-refused",
      reason: `concurrency cap reached: ${others.length} of ${others.length} loops running`,
    });

    await setPolicy({ concurrencyCap: others.length + 1 });
    const resumed = await call(`/sessions/${id}/resume`);
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.deepEqual(resumed.body, { result: "confirmed" });
    assert.match(s.userTexts()[0] ?? "", /^The session was restarted\./);
    assert.equal(s.session().state, "working");
    assert.equal(s.session().stateReason, undefined);
    const states = store
      .listOrchestrationEvents(SBX, 0, 1000)
      .filter((e) => e.cardId === id && e.kind === "supervisor_state")
      .map((e) => [e.data.from, e.data.to]);
    assert.deepEqual(states, [
      ["working", "needs_input"],
      ["needs_input", "working"],
    ]);
  },
);

void test(
  "resume_loop is refused after a usage stop and a budget stop",
  { skip: !hasTmux },
  async () => {
    const s = await start("resume-refused", { group: true });
    for (const reason of ["usage_stop", "budget"] as const) {
      await setState(s, "needs_input", reason);
      await refused(s, `/sessions/${s.card().id}/resume`, undefined, 403, {
        error: "policy-refused",
        reason: "user must resume",
      });
    }
    assert.deepEqual(s.userTexts(), []);
  },
);

void test("every session route refuses a card of another board", async () => {
  const card = await store.createLocalCard(OTH, "foreign", "");
  const routes: [string, unknown][] = [
    [`/sessions/${card.id}/input`, { text: "x" }],
    [`/groups/${card.id}/approve-roadmap`, { decisionIds: ["dec-1"] }],
    [`/sessions/${card.id}/handoff`, {}],
    [`/sessions/${card.id}/resume`, undefined],
    [`/sessions/${card.id}/stop`, undefined],
  ];
  for (const [route, body] of routes) {
    const reply = await call(route, body);
    assert.equal(reply.status, 403, route);
    assert.equal(reply.body.error, "other-board", route);
  }
});

void test(
  "every key tool refuses a user stop, and a stop never hides it",
  { skip: !hasTmux },
  async () => {
    const s = await start("user-stop", { group: true });
    const id = s.card().id;
    await setPolicy({ roadmapApproval: "all" });
    for (const reason of ["usage_stop", "budget"] as const) {
      await setState(s, "needs_input", reason);
      for (const [route, body] of [
        [`/groups/${id}/approve-roadmap`, { decisionIds: ["dec-1"] }],
        [`/sessions/${id}/handoff`, {}],
        [`/sessions/${id}/stop`, undefined],
        [`/sessions/${id}/resume`, undefined],
      ] as const) {
        await refused(s, route, body, 403, {
          error: "policy-refused",
          reason: "user must resume",
        });
      }
    }
    assert.deepEqual(s.userTexts(), []);
  },
);

void test(
  "a second tool on the same card while one runs is 409 session-busy",
  { skip: !hasTmux },
  async () => {
    const s = await start("busy");
    const route = `/sessions/${s.card().id}/input`;
    const replies = await Promise.all([
      call(route, { text: "first answer" }),
      call(route, { text: "second answer" }),
    ]);
    assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
    const busy = replies.find((r) => r.status === 409);
    assert.equal(busy?.body.error, "session-busy");
    assert.equal(s.userTexts().length, 1);
    const blank = await call(route, { text: "   " });
    assert.equal(blank.status, 400);
    assert.equal(blank.body.error, "invalid-text");
  },
);

void test(
  "send_input refuses a text that starts with a Claude Code mode character",
  { skip: !hasTmux },
  async () => {
    const s = await start("input-mode");
    const route = `/sessions/${s.card().id}/input`;
    const texts = ["!", "/", "#", "&", "@"].flatMap((c) => [
      `${c}ls -la`,
      `  ${c}ls`,
      `${c}${"x".repeat(600)}`,
    ]);
    for (const text of texts) {
      await refused(s, route, { text }, 400, {
        error: "invalid-text",
        reason: "text starts with a mode character",
      });
    }
    for (const text of [
      "\u0001!x",
      "\u0085!x",
      "\u001b!x",
      "\u007f/x",
      `\u0001!${"x".repeat(600)}`,
    ]) {
      await refused(s, route, { text }, 400, {
        error: "invalid-text",
        reason: "text starts with a mode character",
      });
    }
    await refused(s, route, { text: "\u0001" }, 400, {
      error: "invalid-text",
      reason: "text is empty after control characters are removed",
    });
    const ok = await call(route, { text: "run ! later / not a mode" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(s.userTexts(), ["run ! later / not a mode"]);
  },
);

void test(
  "every session tool refuses 409 ship-running while the card's ship flow runs",
  { skip: !hasTmux },
  async () => {
    const s = await start("ship-running", { group: true });
    const id = s.card().id;
    await setPolicy({ roadmapApproval: "all" });
    const flow: ShipFlow = {
      state: "running",
      rights: "open_prs",
      repository: "/tmp/repo",
      repo: null,
      orchestratorId: "orc-sbx",
      identity: { name: "a", email: "a@example.com" },
      branches: [],
      failedStep: null,
      reason: null,
      decisionId: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    await store.setShipFlow(id, flow);
    await setState(s, "needs_input", "stop_session");
    for (const [route, body] of [
      [`/sessions/${id}/input`, { text: "x" }],
      [`/groups/${id}/approve-roadmap`, { decisionIds: ["dec-1"] }],
      [`/sessions/${id}/handoff`, {}],
      [`/sessions/${id}/resume`, undefined],
      [`/sessions/${id}/stop`, undefined],
    ] as const) {
      await refused(s, route, body, 409, { error: "ship-running" });
    }
    await store.setShipFlow(id, { ...flow, state: "stopped" });
    const sent = await call(`/sessions/${id}/input`, { text: "after ship" });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.deepEqual(s.userTexts(), ["after ship"]);
  },
);

void test(
  "stop_session is refused in each keyless state and sends no key",
  { skip: !hasTmux },
  async () => {
    const s = await start("stop-keyless", { group: true });
    for (const state of KEYLESS) {
      await setState(s, state);
      await refused(s, `/sessions/${s.card().id}/stop`, undefined, 409, {
        error: "session-state-refused",
        reason: `session is at ${state}`,
      });
    }
    assert.deepEqual(s.keys(), []);
  },
);

void test(
  "resume_loop is refused over budget with the budget reason and sends nothing",
  { skip: !hasTmux },
  async () => {
    const s = await start("resume-budget", { group: true });
    await setState(s, "needs_input", "stop_session");
    await store.setSessionMetersIfSession(s.card().id, s.name, {
      contextPercent: 10,
      model: "m",
      cost: 2,
      usage: { fiveHourPercent: null, sevenDayPercent: null },
    });
    await setPolicy({ concurrencyCap: 50, budgetPerGroup: 1 });
    try {
      await refused(s, `/sessions/${s.card().id}/resume`, undefined, 403, {
        error: "policy-refused",
        reason: "budget reached: cost 2 of 1",
      });
    } finally {
      await setPolicy({ budgetPerGroup: null });
    }
    assert.deepEqual(s.userTexts(), []);
  },
);

void test(
  "resume_loop continues a loop that the supervisor gave up on",
  { skip: !hasTmux },
  async () => {
    const s = await start("resume-gave-up", { group: true });
    await setPolicy({ concurrencyCap: 50, budgetPerGroup: null });
    await setState(s, "needs_input", "supervisor_gave_up");
    const reply = await call(`/sessions/${s.card().id}/resume`);
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.deepEqual(reply.body, { result: "confirmed" });
    assert.match(s.userTexts()[0] ?? "", /^The session was restarted\./);
    assert.equal(s.session().state, "working");
    assert.equal(s.session().stateReason, undefined);
  },
);

void test(
  "request_handoff refuses a non boolean hard and a card with no loop",
  { skip: !hasTmux },
  async () => {
    const s = await start("handoff-refused", { group: true });
    const route = `/sessions/${s.card().id}/handoff`;
    await refused(s, route, { hard: "yes" }, 400, { error: "invalid-hard" });
    await store.setLoopProgress(s.card().id, { ...LOOP_PROGRESS, slug: "" });
    await refused(s, route, {}, 409, { error: "no-loop" });
    assert.deepEqual(s.userTexts(), []);
  },
);

void test(
  "approve_roadmap at the rules level sends the approval with no decision item",
  { skip: !hasTmux },
  async () => {
    const s = await start("approve-rules", { group: true });
    await setPolicy({ roadmapApproval: "rules" });
    try {
      const reply = await call(`/groups/${s.card().id}/approve-roadmap`, {
        decisionIds: ["dec-1"],
      });
      assert.equal(reply.status, 200, JSON.stringify(reply.body));
      assert.deepEqual(reply.body, { result: "confirmed" });
      assert.deepEqual(s.userTexts(), [
        "Roadmap approved (decisions dec-1). Continue the loop.",
      ]);
    } finally {
      await setPolicy({ roadmapApproval: "all" });
    }
  },
);

void test(
  "approve_roadmap under ask refuses an answered approve item of another card and of another kind",
  { skip: !hasTmux },
  async () => {
    const s = await start("approve-foreign", { group: true });
    const id = s.card().id;
    const route = `/groups/${id}/approve-roadmap`;
    const elsewhere = await store.createLocalCard(SBX, "elsewhere", "");
    const answered = (
      itemId: string,
      cardId: string,
      kind: DecisionItem["kind"],
    ) => {
      store.insertDecisionItem({
        id: itemId,
        boardKey: SBX,
        cardId,
        orchestratorId: "orc-sbx",
        kind,
        question: "Approve?",
        options: [
          { id: "approve", label: "Approve" },
          { id: "reject", label: "Reject" },
        ],
        recommendedOptionId: "approve",
        state: "open",
        answer: null,
        createdAt: new Date().toISOString(),
        answeredAt: null,
      });
      assert.ok(
        store.answerDecisionItem(itemId, { optionId: "approve", note: null }),
      );
    };
    answered("dec-other-card", elsewhere.id, "roadmap_approval");
    answered("dec-other-kind", id, "ruling");
    await setPolicy({ roadmapApproval: "ask" });
    try {
      const refusal = {
        error: "policy-refused",
        reason: "roadmap approval needs an answered approve item from the user",
      };
      for (const decisionIds of [
        ["dec-other-card"],
        ["dec-other-kind"],
        ["dec-other-card", "dec-other-kind"],
      ]) {
        await refused(s, route, { decisionIds }, 403, refusal);
      }
      for (const itemId of ["dec-other-card", "dec-other-kind"]) {
        assert.equal(store.getDecisionItem(itemId)?.consumedAt, undefined);
      }
      assert.deepEqual(s.userTexts(), []);
    } finally {
      await setPolicy({ roadmapApproval: "all" });
    }
  },
);

void test(
  "resume_loop whose send is unconfirmed leaves the session stopped and resumable",
  { skip: !hasTmux },
  async () => {
    const s = await start("resume-lost", {
      group: true,
      scenario: { transcriptPath: path.join(env.root, "resume-lost.jsonl") },
    });
    const id = s.card().id;
    const route = `/sessions/${id}/resume`;
    await setPolicy({ concurrencyCap: 50, budgetPerGroup: null });
    await setState(s, "needs_input", "stop_session");
    const column = s.card().column;
    for (const attempt of [1, 2]) {
      const reply = await call(route);
      assert.equal(reply.status, 200, JSON.stringify(reply.body));
      assert.deepEqual(reply.body, { result: "unconfirmed" }, `${attempt}`);
      assert.equal(s.session().state, "needs_input");
      assert.equal(s.session().stateReason, "stop_session");
      assert.equal(s.card().column, column);
    }
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
        .map((e) => [e.data.kind, e.data.result, e.data.reason]),
      [
        ["resume", "unconfirmed", "not in transcript"],
        ["resume", "unconfirmed", "not in transcript"],
      ],
    );
  },
);
