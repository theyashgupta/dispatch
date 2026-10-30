import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";
import { setGhScenario, writeFakeGh } from "../test-support/fake-gh.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type { BoardKey, Card } from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { gitOutput, shipStack } =
  await import("../test-support/git-fixtures.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const express = (await import("express")).default;
const { orchestratorRouter } = await import("./orchestrator.route.js");
const { boardsRouter } = await import("./boards.route.js");
const { shipTools } = await import("../services/orchestration/ship-flow.js");
const { supervisePane } =
  await import("../services/orchestration/supervisor-registry.js");
const { refreshLoopProgress } =
  await import("../services/orchestration/loop-progress-reader.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const SLUG = "sbx-151";
const PROMISE = `RALPH COMPLETE ${SLUG}`;
const PANES = new URL("../test-support/fixtures/panes/", import.meta.url);
const stack = await shipStack();
shipTools.pollMs = 50;

setOrchestrationConfig({ linearApiKey: "" });
await store.load();
await store.createBoard({
  key: SBX,
  name: SBX,
  workspaceRoot: "/sbx/sessions",
  repositories: [{ path: stack.repo, baseBranch: "main", checkCommand: "" }],
  linearTeamKeys: [],
});
const gh = writeFakeGh(env.binDir, stack.root);
setGhScenario(gh.scenario, { checks: "pass" });

/**
 * Listen on the first free port of 48940..48999.
 *
 * @remarks The ticket sandbox rule asks for a port above 48900.
 */
async function listenInTestRange(
  app: ReturnType<typeof express>,
): Promise<Server> {
  for (let port = 48940; port <= 48999; port++) {
    const server = await new Promise<Server | null>((resolve) => {
      const s = app.listen(port, "127.0.0.1");
      s.once("listening", () => resolve(s));
      s.once("error", () => resolve(null));
    });
    if (server !== null) return server;
  }
  throw new Error("no free port in 48940..48999");
}

const app = express();
app.use("/api/orchestrator", express.json(), orchestratorRouter);
app.use("/api", express.json(), boardsRouter);
const server = await listenInTestRange(app);
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  fs.rmSync(stack.root, { recursive: true, force: true });
  env.cleanup();
});

async function raw(
  method: string,
  route: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${route}`, {
    method,
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

const minted = await raw("POST", "/boards/SBX/orchestrators/orc-sbx/token");
const TOKEN = minted.body.token as string;

/** A started SBX ticket card in Done whose session branch is ahead of `main` with a tree `main` lacks. */
async function launchedTicket(ws: string = stack.ws): Promise<Card> {
  const t = await store.createLocalCard(SBX, "launched ticket", "");
  await store.setOrchestratorFields(t.id, { launch: { direction: "ship it" } });
  await store.setCardWorkspace(t.id, {
    folder: ws,
    repos: [{ path: stack.repo, base: "main" }],
  });
  await store.completeStart(t.id, undefined, {
    workspacePath: ws,
    tmuxSession: `dsp-${t.id}`,
    branch: t.id,
  });
  await store.applyMarker(
    t.id,
    undefined,
    "agent_done",
    undefined,
    `marker-${t.id}`,
    "status_agent_done",
  );
  const tip = await gitOutput(
    stack.repo,
    "commit-tree",
    await gitOutput(stack.repo, "rev-parse", "unit-2^{tree}"),
    "-p",
    "main",
    "-m",
    `${t.id} work`,
  );
  await gitOutput(stack.repo, "branch", t.id, tip);
  return store.getCard(t.id)!;
}

const shipOf = (card: Card) =>
  raw(
    "POST",
    `/orchestrator/groups/${card.id}/ship`,
    {
      repository: stack.repo,
      branches: [
        { name: card.id, title: `feat: ${card.id}`, body: `What: ${card.id}` },
      ],
    },
    TOKEN,
  );

/** Seed a finished single PRD loop in the session root, outside the worktree, with its engine file still open. */
function seedFinishedLoop(ws: string = stack.ws, phases: number = 2): string {
  const engine = path.join(ws, ".claude", "ralph-loop.local.md");
  const prd = path.join(ws, "plan", ".planning", "prds", "demo.md");
  const feature = path.join(ws, "plan", ".planning", SLUG);
  fs.mkdirSync(path.dirname(engine), { recursive: true });
  fs.mkdirSync(path.dirname(prd), { recursive: true });
  fs.mkdirSync(feature, { recursive: true });
  fs.writeFileSync(
    engine,
    `---\nactive: true\niteration: 1\nsession_id: sess-151\ncompletion_promise: "${PROMISE}"\n---\nExecute the PRD at ${prd} per the ralph-loop skill.\n`,
  );
  fs.writeFileSync(prd, "# SBX 151\n\n### Phase 1: One\n\n### Phase 2: Two\n");
  fs.writeFileSync(
    path.join(feature, "state.md"),
    [
      "phase 1 One GREEN 2026-10-16T04:00:00Z gate=pass",
      "phase 2 Two GREEN 2026-10-16T05:00:00Z gate=pass",
    ]
      .slice(0, phases)
      .join("\n") + "\n",
  );
  return engine;
}

/** Write a transcript whose last assistant message ends with the promise and the DONE marker. */
function seedTranscript(
  name: string = "sess-151",
  text: string = `Both phases are green and the branch is ready.\n<promise>${PROMISE}</promise>\nDISPATCH_STATUS: DONE - ${SLUG} built`,
): string {
  const file = path.join(stack.root, "transcripts", `${name}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entry = (type: "user" | "assistant", text: string) =>
    JSON.stringify({
      type,
      uuid: `${type}-${text.length}`,
      timestamp: "2026-10-16T05:30:00.000Z",
      message: { content: [{ type: "text", text }] },
    });
  fs.writeFileSync(
    file,
    [entry("user", "build sbx-151"), entry("assistant", text)].join("\n") +
      "\n",
  );
  return file;
}

async function enableSupervisor(): Promise<void> {
  await store.setBoardPolicy(SBX, {
    ...store.getBoard(SBX)!.policy,
    supervisor: "on",
    shipRights: "merge",
  });
}

const sessionOf = (card: Card) =>
  card.sessions!.find((s) => s.id === card.activeSessionId)!;

/** Seed a finished loop and its transcript for a card; resolves the engine file path. */
async function seedLoop(
  card: Card,
  ws: string,
  opts: { phases?: number; transcript: string },
): Promise<string> {
  const engine = seedFinishedLoop(ws, opts.phases);
  await refreshLoopProgress(card.id);
  await store.setTranscriptPath(
    card.id,
    sessionOf(card).id,
    seedTranscript(opts.transcript),
  );
  return engine;
}

/** Feed the registry three pane samples, one minute apart, from `firstTick`. */
async function sampleThrice(card: Card, firstTick: number = 1): Promise<void> {
  const session = sessionOf(card);
  const pane = fs.readFileSync(
    new URL("after-pause-job-lines.txt", PANES),
    "utf8",
  );
  for (let tick = firstTick; tick < firstTick + 3; tick++) {
    await supervisePane(
      {
        cardId: card.id,
        sessionId: session.id,
        tmuxSession: session.tmuxSession!,
        pane,
      },
      tick * 60_000,
    );
  }
}

async function superviseFinishedLoop(
  card: Card,
  ws: string,
  opts: { phases?: number; transcript: string },
): Promise<string> {
  const engine = await seedLoop(card, ws, opts);
  await sampleThrice(card);
  return engine;
}

const closeLoopEvents = (card: Card) =>
  store
    .listOrchestrationEvents(SBX, 0, 10_000)
    .filter(
      (e) =>
        e.kind === "supervisor_action" &&
        e.cardId === card.id &&
        e.data.action === "close_loop",
    );

const closedEvents = (card: Card) =>
  closeLoopEvents(card).filter((e) => e.data.result === "closed");

const ownRoot = (name: string) =>
  fs.mkdtempSync(path.join(stack.root, `${name}-`));

void test("a finished single PRD loop whose promise and DONE line are only in the transcript is closed, so start_ship answers 202", async () => {
  await enableSupervisor();
  const card = await launchedTicket();
  const engine = await superviseFinishedLoop(card, stack.ws, {
    transcript: "sess-151",
  });

  const reply = await shipOf(card);
  assert.equal(reply.status, 202, JSON.stringify(reply.body));

  assert.equal(closedEvents(card).length, 1);
  assert.equal(closedEvents(card)[0]?.data.reason, "done_marker");
  await sampleThrice(card, 4);
  assert.equal(closeLoopEvents(card).length, 1);
  const progress = store.getCard(card.id)?.loopProgress;
  assert.equal(progress?.completion, "complete");
  assert.equal(progress?.engine?.closed, true);
  assert.equal(progress?.engine?.closedReason, "done_marker");
  assert.equal(fs.existsSync(engine), false);
  assert.equal(fs.existsSync(`${engine}.done`), true);
  await waitFor(
    () => Promise.resolve(store.getCard(card.id)?.shipFlow?.state === "done"),
    30_000,
    "flow done",
  );
});

void test("a loop whose transcript has the promise but whose progress is not complete keeps its engine open", async () => {
  await enableSupervisor();
  const ws = ownRoot("ws-running");
  const card = await launchedTicket(ws);
  const engine = await superviseFinishedLoop(card, ws, {
    phases: 1,
    transcript: "sess-running",
  });

  assert.equal(store.getCard(card.id)?.loopProgress?.completion, "running");
  assert.equal(closeLoopEvents(card).length, 0);
  assert.equal(fs.existsSync(engine), true);
  assert.equal(fs.existsSync(`${engine}.done`), false);
  const reply = await shipOf(card);
  assert.equal(reply.status, 409, JSON.stringify(reply.body));
  assert.equal(reply.body.error, "engine-not-closed");
});

void test("a finished loop stored as needs_input with supervisor_gave_up is still closed", async () => {
  await enableSupervisor();
  const ws = ownRoot("ws-held");
  const card = await launchedTicket(ws);
  await store.setSessionStateIfSession(
    card.id,
    sessionOf(card).id,
    "needs_input",
    "supervisor_gave_up",
  );
  const engine = await superviseFinishedLoop(card, ws, {
    transcript: "sess-held",
  });

  assert.equal(closedEvents(card).length, 1);
  assert.equal(store.getCard(card.id)?.loopProgress?.engine?.closed, true);
  assert.equal(fs.existsSync(engine), false);
  assert.equal(fs.existsSync(`${engine}.done`), true);
});

void test("a finished loop stored as idle is closed at the next sample", async () => {
  await enableSupervisor();
  const ws = ownRoot("ws-idle");
  const card = await launchedTicket(ws);
  await store.setSessionStateIfSession(card.id, sessionOf(card).id, "idle");
  const engine = await superviseFinishedLoop(card, ws, {
    transcript: "sess-idle",
  });

  assert.equal(closedEvents(card).length, 1);
  assert.equal(store.getCard(card.id)?.loopProgress?.engine?.closed, true);
  assert.equal(fs.existsSync(`${engine}.done`), true);
});

void test("a failed rename is recorded, leaves the engine open, and is retried once a minute", async (t) => {
  if (process.getuid?.() === 0) return t.skip("root ignores directory modes");
  await enableSupervisor();
  const ws = ownRoot("ws-readonly");
  const card = await launchedTicket(ws);
  const engine = await seedLoop(card, ws, { transcript: "sess-readonly" });
  const dir = path.dirname(engine);
  const session = sessionOf(card);
  const pane = fs.readFileSync(
    new URL("after-pause-job-lines.txt", PANES),
    "utf8",
  );
  const sampleAt = (at: number) =>
    supervisePane(
      {
        cardId: card.id,
        sessionId: session.id,
        tmuxSession: session.tmuxSession!,
        pane,
      },
      at,
    );
  fs.chmodSync(dir, 0o555);
  try {
    await sampleAt(60_000);
    await sampleAt(62_000);
    assert.equal(closeLoopEvents(card).length, 1);
    await sampleAt(120_000);
    const failed = closeLoopEvents(card);
    assert.equal(failed.length, 2);
    for (const e of failed) assert.match(String(e.data.result), /^failed/);
    await sampleAt(150_000);
    assert.equal(closeLoopEvents(card).length, 2);
    assert.equal(store.getCard(card.id)?.loopProgress?.engine?.closed, false);
    assert.equal(fs.existsSync(engine), true);
  } finally {
    fs.chmodSync(dir, 0o755);
  }

  await sampleAt(4 * 60_000);
  assert.equal(closedEvents(card).length, 1);
  assert.equal(store.getCard(card.id)?.loopProgress?.engine?.closed, true);
  assert.equal(fs.existsSync(`${engine}.done`), true);
});

/** Seeds an engine file whose prompt has no PRD path line, so no phase can vouch for completion. */
function seedLoopWithoutPrdPath(ws: string): string {
  const engine = path.join(ws, ".claude", "ralph-loop.local.md");
  fs.mkdirSync(path.dirname(engine), { recursive: true });
  fs.writeFileSync(
    engine,
    `---\nactive: true\niteration: 1\nsession_id: sess-151\ncompletion_promise: "${PROMISE}"\n---\nExecute ${SLUG} per the ralph-loop skill. Unit A: PRD .planning/prds/demo.md, state .planning/${SLUG}/state.md. When done output the phrase ${PROMISE} wrapped in promise tags.\n`,
  );
  return engine;
}

async function superviseLoopWithoutPrdPath(
  card: Card,
  ws: string,
  transcript: string,
): Promise<string> {
  const engine = seedLoopWithoutPrdPath(ws);
  await refreshLoopProgress(card.id);
  await store.setTranscriptPath(card.id, sessionOf(card).id, transcript);
  await sampleThrice(card);
  return engine;
}

void test("a single PRD loop with no PRD path in its prompt is closed on the promise and the DONE line in the transcript", async () => {
  await enableSupervisor();
  const ws = ownRoot("ws-unvouched");
  const card = await launchedTicket(ws);
  const engine = await superviseLoopWithoutPrdPath(
    card,
    ws,
    seedTranscript("sess-unvouched"),
  );

  assert.equal(fs.existsSync(engine), false);
  const done = fs.readFileSync(`${engine}.done`, "utf8");
  assert.match(done, /^closed_reason: done_marker$/m);
  assert.match(done, /wrapped in promise tags\.\n$/);
  const events = closeLoopEvents(card);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.data.result, "closed");
  assert.equal(events[0]?.data.reason, "done_marker");
  const stored = store.getCard(card.id)?.loopProgress?.engine;
  assert.equal(stored?.closed, true);
  assert.equal(stored?.closedReason, "done_marker");
});

void test("a single PRD loop with no PRD path keeps its engine open when the promise is for another slug", async () => {
  await enableSupervisor();
  const ws = ownRoot("ws-other-slug");
  const card = await launchedTicket(ws);
  const engine = await superviseLoopWithoutPrdPath(
    card,
    ws,
    seedTranscript(
      "sess-other-slug",
      "All done.\n<promise>RALPH COMPLETE other-slug</promise>\nDISPATCH_STATUS: DONE - other-slug built",
    ),
  );

  assert.equal(fs.existsSync(engine), true);
  assert.equal(fs.existsSync(`${engine}.done`), false);
  assert.equal(store.getCard(card.id)?.loopProgress?.engine?.closed, false);
  assert.equal(closeLoopEvents(card).length, 0);
});

void test("a loop whose engine file the plugin already removed is closed on the promise and the DONE line", async () => {
  await enableSupervisor();
  const ws = ownRoot("ws-plugin-removed");
  const card = await launchedTicket(ws);
  const engine = seedLoopWithoutPrdPath(ws);
  await refreshLoopProgress(card.id);
  await store.setTranscriptPath(
    card.id,
    sessionOf(card).id,
    seedTranscript("sess-plugin-removed"),
  );
  fs.unlinkSync(engine);
  await sampleThrice(card);

  const done = fs.readFileSync(`${engine}.done`, "utf8");
  assert.match(done, /^closed_reason: done_marker$/m);
  assert.match(done, /^active: false$/m);
  const stored = store.getCard(card.id)?.loopProgress;
  assert.equal(stored?.engine?.closed, true);
  assert.equal(stored?.engine?.closedReason, "done_marker");
  assert.equal(stored?.completion, "complete");
  const events = closeLoopEvents(card);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.data.result, "closed");
  const reply = await shipOf(card);
  assert.notEqual(reply.body.error, "engine-not-closed");
  assert.notEqual(reply.body.error, "loop-not-finished");
});

void test("a finished loop whose engine file is deleted with no promise and no DONE line still answers 409 engine-not-closed", async () => {
  const ws = ownRoot("ws-deleted-open");
  const card = await launchedTicket(ws);
  const engine = seedFinishedLoop(ws);
  await refreshLoopProgress(card.id);
  assert.equal(store.getCard(card.id)?.loopProgress?.engine?.active, true);
  fs.unlinkSync(engine);
  await refreshLoopProgress(card.id);

  const progress = store.getCard(card.id)?.loopProgress;
  assert.equal(progress?.engine?.active, true);
  assert.equal(progress?.engine?.closed, false);
  const reply = await shipOf(card);
  assert.equal(reply.status, 409, JSON.stringify(reply.body));
  assert.equal(reply.body.error, "engine-not-closed");
  assert.equal(fs.existsSync(`${engine}.done`), false);
});

void test("a finished loop whose transcript has the promise but no DONE line keeps its engine open, so start_ship answers 409 engine-not-closed", async () => {
  await enableSupervisor();
  const ws = ownRoot("ws-promise-only");
  const card = await launchedTicket(ws);
  const engine = seedFinishedLoop(ws);
  await refreshLoopProgress(card.id);
  await store.setTranscriptPath(
    card.id,
    sessionOf(card).id,
    seedTranscript(
      "sess-promise-only",
      `Both phases are green.\n<promise>${PROMISE}</promise>`,
    ),
  );
  await sampleThrice(card);

  const progress = store.getCard(card.id)?.loopProgress;
  assert.equal(progress?.completion, "complete");
  assert.equal(progress?.engine?.closed, false);
  assert.equal(closeLoopEvents(card).length, 0);
  assert.equal(fs.existsSync(engine), true);
  assert.equal(fs.existsSync(`${engine}.done`), false);
  const reply = await shipOf(card);
  assert.equal(reply.status, 409, JSON.stringify(reply.body));
  assert.equal(reply.body.error, "engine-not-closed");
  assert.equal(store.getCard(card.id)?.shipFlow, undefined);
});
