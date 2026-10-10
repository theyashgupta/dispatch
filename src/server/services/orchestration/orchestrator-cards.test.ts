import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey, BoardPolicy, Card } from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { startedGroup } from "../../test-support/group-fixtures.js";
import {
  ConflictError,
  PolicyError,
  ValidationError,
} from "../domain/errors.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { tempRepoWithWorkspace } =
  await import("../../test-support/git-fixtures.js");
const { setOrchestrationConfig } = await import("../infra/config-holder.js");
const { seedPlaybooks } = await import("../infra/playbooks.js");
const { runningLoops } = await import("./boards.js");
const { sessionStarter } = await import("./start-session.js");
const { startOrchestratorCard } = await import("./orchestrator-cards.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const NOB = parseBoardKey("NOB") as BoardKey;
const EMP = parseBoardKey("EMP") as BoardKey;
const fixture = await tempRepoWithWorkspace();
const repo = fixture.repo;
const CALLER = { boardKey: SBX, orchestratorId: "orc-sbx" };
const PLAYBOOK = "Write code directly";

const starts: { id: string; extraDirection: string; playbook?: string }[] = [];
sessionStarter.start = (id, extraDirection, _config, opts) => {
  starts.push({ id, extraDirection, playbook: opts?.playbook });
  return Promise.resolve();
};

setOrchestrationConfig({ linearApiKey: "" });
await store.load();
for (const [key, repositories] of [
  [SBX, [{ path: repo, baseBranch: "main", checkCommand: "" }]],
  [NOB, [{ path: repo, baseBranch: "", checkCommand: "" }]],
  [EMP, []],
] as const) {
  await store.createBoard({
    key,
    name: key,
    workspaceRoot: `/${key.toLowerCase()}/sessions`,
    repositories: [...repositories],
    linearTeamKeys: [],
  });
}
await seedPlaybooks();
after(() => {
  fs.rmSync(fixture.root, { recursive: true, force: true });
  env.cleanup();
});

async function setPolicy(patch: Partial<BoardPolicy>): Promise<void> {
  await store.setBoardPolicy(SBX, { ...store.getBoard(SBX)!.policy, ...patch });
}

async function ticket(board: BoardKey = SBX): Promise<Card> {
  return store.createLocalCard(board, "ticket", "");
}

async function runningTicket(launched: boolean): Promise<Card> {
  const card = await ticket();
  await store.completeStart(card.id, undefined, {
    workspacePath: `/tmp/ws-${card.id}`,
    tmuxSession: `dsp-${card.id}`,
    branch: card.id,
  });
  if (launched) {
    await store.setOrchestratorFields(card.id, {
      launch: { playbook: PLAYBOOK, direction: "" },
    });
  }
  return store.getCard(card.id)!;
}

function nothingWritten(card: Card, startsBefore: number): void {
  assert.equal(store.getCard(card.id)?.launch, undefined);
  assert.equal(store.getCard(card.id)?.ownerOrchestrator, undefined);
  assert.equal(starts.length, startsBefore);
}

async function refused(
  card: Card,
  input: Parameters<typeof startOrchestratorCard>[2],
  kind: new (...args: never[]) => Error,
  code?: string,
): Promise<void> {
  const startsBefore = starts.length;
  await assert.rejects(
    startOrchestratorCard(CALLER, store.getCard(card.id)!, input),
    (err) =>
      err instanceof kind &&
      (code === undefined || (err as { code?: string }).code === code),
  );
  nothingWritten(card, startsBefore);
}

void test("repos given: the card stores them, with the parent folder of the first repository", async () => {
  const card = await ticket();
  const out = await startOrchestratorCard(CALLER, card, {
    playbook: PLAYBOOK,
    repos: [{ path: repo, base: "main" }],
  });
  assert.deepEqual(out, { started: true, cardId: card.id, playbook: PLAYBOOK });
  assert.deepEqual(store.getCard(card.id)?.workspace, {
    folder: path.dirname(repo),
    repos: [{ path: repo, base: "main" }],
  });
  assert.equal(starts.at(-1)?.id, card.id);
});

void test("repos given with a folder: the card stores that folder", async () => {
  const card = await ticket();
  await startOrchestratorCard(CALLER, card, {
    playbook: PLAYBOOK,
    folder: fixture.root,
    repos: [{ path: repo, base: "main" }],
  });
  assert.equal(store.getCard(card.id)?.workspace?.folder, fixture.root);
});

void test("no repos and a stored workspace: the stored workspace stays", async () => {
  const card = await ticket();
  const stored = { folder: fixture.root, repos: [{ path: repo, base: "dev" }] };
  await store.setCardWorkspace(card.id, stored);
  await startOrchestratorCard(CALLER, card, { playbook: PLAYBOOK });
  assert.deepEqual(store.getCard(card.id)?.workspace, stored);
  assert.equal(starts.at(-1)?.id, card.id);
});

void test("no repos and no stored workspace: every board repository with its base", async () => {
  const card = await ticket();
  await startOrchestratorCard(CALLER, card, { playbook: PLAYBOOK });
  assert.deepEqual(store.getCard(card.id)?.workspace, {
    folder: path.dirname(repo),
    repos: [{ path: repo, base: "main" }],
  });
});

void test("a board repository with no base refuses missing-base, and a board with none refuses invalid-repos", async () => {
  const caller = { boardKey: NOB, orchestratorId: "orc-nob" };
  const noBase = await ticket(NOB);
  const startsBefore = starts.length;
  await assert.rejects(
    startOrchestratorCard(caller, noBase, { playbook: PLAYBOOK }),
    (err) => err instanceof ValidationError && err.code === "missing-base",
  );
  const empty = await ticket(EMP);
  await assert.rejects(
    startOrchestratorCard({ boardKey: EMP, orchestratorId: "orc-emp" }, empty, {
      playbook: PLAYBOOK,
    }),
    (err) => err instanceof ValidationError && err.code === "invalid-repos",
  );
  assert.equal(starts.length, startsBefore);
  for (const card of [noBase, empty]) {
    assert.equal(store.getCard(card.id)?.launch, undefined);
    assert.equal(store.getCard(card.id)?.workspace, undefined);
  }
});

void test("a repository that is not a board repository is refused", async () => {
  await refused(
    await ticket(),
    { playbook: PLAYBOOK, repos: [{ path: "/tmp/elsewhere", base: "main" }] },
    ValidationError,
    "unknown-repository",
  );
});

void test("a group card, a running card, a Done card and an Inbox card are refused", async () => {
  const { g } = await startedGroup(store, { board: SBX });
  await refused(g, { playbook: PLAYBOOK }, ValidationError, "not-ticket-card");
  await refused(
    await runningTicket(false),
    { playbook: PLAYBOOK },
    ConflictError,
    "already-started",
  );
  const done = await ticket();
  await store.moveCardManual(done.id, "done");
  assert.equal(store.getCard(done.id)?.column, "done");
  await refused(done, { playbook: PLAYBOOK }, ConflictError);
  const inbox = await ticket();
  await store.moveCardManual(inbox.id, "inbox");
  assert.equal(store.getCard(inbox.id)?.column, "inbox");
  await refused(inbox, { playbook: PLAYBOOK }, ConflictError);
});

void test("a card with a start in flight is refused as already started", async () => {
  const card = await ticket();
  store.beginStart(card.id);
  try {
    await refused(
      card,
      { playbook: PLAYBOOK },
      ConflictError,
      "already-started",
    );
  } finally {
    store.endStart(card.id);
  }
});

void test("the Board Orchestrator playbook and an unknown playbook are refused", async () => {
  const card = await ticket();
  await refused(
    card,
    { playbook: "Board Orchestrator" },
    ValidationError,
    "orchestrator-playbook",
  );
  await refused(
    card,
    { playbook: "No such playbook" },
    ValidationError,
    "unknown-playbook",
  );
});

void test("a start writes launch and the owner, and keeps an owner the card has", async () => {
  const fresh = await ticket();
  await startOrchestratorCard(CALLER, fresh, {
    playbook: PLAYBOOK,
    direction: "fix the typo",
  });
  const stored = store.getCard(fresh.id)!;
  assert.deepEqual(stored.launch, {
    playbook: PLAYBOOK,
    direction: "fix the typo",
  });
  assert.equal(stored.ownerOrchestrator, "orc-sbx");
  assert.deepEqual(starts.at(-1), {
    id: fresh.id,
    extraDirection: "fix the typo",
    playbook: PLAYBOOK,
  });

  const owned = await ticket();
  await store.setOrchestratorFields(owned.id, {
    ownerOrchestrator: "orc-other",
  });
  await startOrchestratorCard(CALLER, store.getCard(owned.id)!, {
    playbook: PLAYBOOK,
  });
  assert.equal(store.getCard(owned.id)?.ownerOrchestrator, "orc-other");
  assert.deepEqual(store.getCard(owned.id)?.launch, {
    playbook: PLAYBOOK,
    direction: "",
  });
});

void test("the cap counts a running group and a running launched card, and refuses a third start", async () => {
  await startedGroup(store, { board: SBX });
  await runningTicket(true);
  await setPolicy({ concurrencyCap: runningLoops(SBX) });
  const card = await ticket();
  const startsBefore = starts.length;
  await assert.rejects(
    startOrchestratorCard(CALLER, card, { playbook: PLAYBOOK }),
    PolicyError,
  );
  nothingWritten(card, startsBefore);
  await setPolicy({ concurrencyCap: runningLoops(SBX) + 1 });
  await startOrchestratorCard(CALLER, card, { playbook: PLAYBOOK });
  assert.equal(starts.length, startsBefore + 1);
});

void test("a start at a full cap is refused as policy-refused and writes no launch and no owner", async () => {
  await runningTicket(true);
  await setPolicy({ concurrencyCap: runningLoops(SBX) });
  try {
    await refused(
      await ticket(),
      { playbook: PLAYBOOK, repos: [{ path: repo, base: "main" }] },
      PolicyError,
      "policy-refused",
    );
  } finally {
    await setPolicy({ concurrencyCap: 10 });
  }
});

void test("a failed workspace write rejects the start and leaves no launch", async (t) => {
  const card = await ticket();
  const startsBefore = starts.length;
  t.mock.method(store, "setCardWorkspace", () =>
    Promise.reject(new Error("disk full")),
  );
  await assert.rejects(
    startOrchestratorCard(CALLER, card, {
      playbook: PLAYBOOK,
      repos: [{ path: repo, base: "main" }],
    }),
    /disk full/,
  );
  nothingWritten(card, startsBefore);
});

void test("a launched card in Agent done and a running ticket with no launch hold no slot", async () => {
  await setPolicy({ concurrencyCap: 1000 });
  const base = runningLoops(SBX);
  const waiting = await runningTicket(true);
  assert.equal(runningLoops(SBX), base + 1);
  await store.applyMarker(
    waiting.id,
    undefined,
    "agent_done",
    undefined,
    `marker-${waiting.id}`,
    "status_agent_done",
  );
  assert.equal(store.getCard(waiting.id)?.column, "agent_done");
  assert.equal(runningLoops(SBX), base);
  await runningTicket(false);
  assert.equal(runningLoops(SBX), base);
  await setPolicy({ concurrencyCap: base });
  const card = await ticket();
  await assert.rejects(
    startOrchestratorCard(CALLER, card, { playbook: PLAYBOOK }),
    PolicyError,
  );
  await setPolicy({ concurrencyCap: base + 1 });
  await startOrchestratorCard(CALLER, card, { playbook: PLAYBOOK });
  await setPolicy({ concurrencyCap: 10 });
});

void test("two overlapping starts under one free slot start one card", async () => {
  await setPolicy({ concurrencyCap: runningLoops(SBX) + 1 });
  const [a, b] = [await ticket(), await ticket()];
  let started: Card | undefined;
  sessionStarter.start = (id, extraDirection, _config, opts) => {
    starts.push({ id, extraDirection, playbook: opts?.playbook });
    store.beginStart(id);
    return Promise.resolve();
  };
  try {
    const results = await Promise.allSettled([
      startOrchestratorCard(CALLER, a, { playbook: PLAYBOOK }),
      startOrchestratorCard(CALLER, b, { playbook: PLAYBOOK }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [
      "fulfilled",
      "rejected",
    ]);
    const lost = results.findIndex((r) => r.status === "rejected");
    assert.ok(
      (results[lost] as PromiseRejectedResult).reason instanceof PolicyError,
    );
    assert.equal(store.getCard([a, b][lost].id)?.launch, undefined);
    assert.equal(
      store.getCard([a, b][1 - lost].id)?.launch?.playbook,
      PLAYBOOK,
    );
    started = [a, b][1 - lost];
  } finally {
    if (started) store.endStart(started.id);
    sessionStarter.start = (id, extraDirection, _config, opts) => {
      starts.push({ id, extraDirection, playbook: opts?.playbook });
      return Promise.resolve();
    };
    await setPolicy({ concurrencyCap: 10 });
  }
});

void test("two parallel starts of one card with different playbooks start one session and store its playbook", async () => {
  const PLAYBOOK_B = "Superpowers";
  assert.notEqual(PLAYBOOK_B, PLAYBOOK);
  const card = await ticket();
  const startsBefore = starts.length;
  sessionStarter.start = (id, extraDirection, _config, opts) => {
    starts.push({ id, extraDirection, playbook: opts?.playbook });
    store.beginStart(id);
    return Promise.resolve();
  };
  try {
    const playbooks = [PLAYBOOK, PLAYBOOK_B];
    const results = await Promise.allSettled(
      playbooks.map((playbook) =>
        startOrchestratorCard(CALLER, card, { playbook }),
      ),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [
      "fulfilled",
      "rejected",
    ]);
    const won = results.findIndex((r) => r.status === "fulfilled");
    const lost = results[1 - won] as PromiseRejectedResult;
    assert.ok(lost.reason instanceof ConflictError);
    assert.equal(lost.reason.code, "already-started");
    assert.equal(starts.length, startsBefore + 1);
    assert.equal(starts.at(-1)?.playbook, playbooks[won]);
    assert.equal(store.getCard(card.id)?.launch?.playbook, playbooks[won]);
  } finally {
    store.endStart(card.id);
    sessionStarter.start = (id, extraDirection, _config, opts) => {
      starts.push({ id, extraDirection, playbook: opts?.playbook });
      return Promise.resolve();
    };
  }
});
