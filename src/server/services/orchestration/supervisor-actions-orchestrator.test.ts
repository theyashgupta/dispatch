import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { ActionDeps } from "./supervisor-actions.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { parseBoardKey } from "../../../shared/board-key.js";
import type {
  BoardKey,
  OrchestratorRecord,
  Session,
} from "../../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { runActions } = await import("./supervisor-actions.js");

const SBX = parseBoardKey("SBX") as BoardKey;
await store.load();
await store.createBoard({
  key: SBX,
  name: "Sandbox",
  workspaceRoot: "/sbx/sessions",
  repositories: [],
  linearTeamKeys: [],
});
after(() => env.cleanup());

const card = await store.createOrchestratorCard(
  SBX,
  "Orchestrator: Main",
  "main",
);
const session = {
  id: `${card.id}-s1`,
  tmuxSession: `dsp-${card.id}`,
} as Session;

async function setState(state: OrchestratorRecord["state"]): Promise<void> {
  await store.setBoardOrchestrators(SBX, [
    {
      id: "main",
      name: "Main",
      role: "main",
      scope: { groupIds: [], ticketIds: [] },
      policyOverride: {},
      cardId: card.id,
      state,
      createdAt: "2026-10-08T00:00:00.000Z",
    },
  ]);
}

function spyDeps(calls: string[], sent: string[] = []): ActionDeps {
  return {
    send: (_card, _session, text) => {
      sent.push(text);
      return Promise.resolve("confirmed");
    },
    resume: (id) => {
      calls.push(`resume ${id}`);
      return Promise.resolve();
    },
    relaunch: (id) => {
      calls.push(`relaunch ${id}`);
      return Promise.resolve("launched");
    },
    atShellPrompt: () => {
      calls.push("atShellPrompt");
      return Promise.resolve(true);
    },
    claudeUpMs: 10,
  };
}

function lastResumeAction(): Record<string, unknown> | undefined {
  return store
    .listOrchestrationEvents(SBX, 0, 1000)
    .filter((e) => e.cardId === card.id && e.data.action === "resume")
    .at(-1)?.data;
}

for (const state of ["stopped", "stopping", "starting"] as const) {
  void test(`the supervisor never brings back claude for an orchestrator that is ${state}`, async () => {
    await setState(state);
    const calls: string[] = [];
    await runActions(
      store.getCard(card.id)!,
      session,
      [{ kind: "resume" }],
      "tmux: pane at shell prompt",
      spyDeps(calls),
    );
    assert.deepEqual(calls, []);
    assert.equal(lastResumeAction()?.result, "skipped");
    assert.equal(lastResumeAction()?.reason, "the orchestrator is not running");
  });
}

void test("the supervisor relaunches the session of a running orchestrator at the shell prompt", async () => {
  await setState("running");
  const calls: string[] = [];
  await runActions(
    store.getCard(card.id)!,
    session,
    [{ kind: "resume" }],
    "tmux: pane at shell prompt",
    spyDeps(calls),
  );
  assert.ok(calls.includes(`relaunch ${card.id}`), JSON.stringify(calls));
});

void test("after the relaunch the supervisor sends the orchestrator resume prompt and not the loop text", async () => {
  await setState("running");
  await store.completeStart(card.id, undefined, {
    workspacePath: "/sbx/sessions/lead",
    tmuxSession: `dsp-${card.id}`,
    branch: "lead",
  });
  const live = store.getCard(card.id)!;
  const real = live.sessions!.find((x) => x.id === live.activeSessionId)!;
  const sent: string[] = [];
  let prompts = 0;
  const deps = {
    ...spyDeps([], sent),
    atShellPrompt: () => Promise.resolve(prompts++ === 0),
  };
  await runActions(
    live,
    real,
    [{ kind: "resume" }],
    "tmux: pane at shell prompt",
    deps,
  );
  assert.deepEqual(sent, [
    "Resume as the main orchestrator of board SBX. Before any action call read_state, then list_cards, list_events and the open decision items; act only on what the tools return.",
  ]);
});
