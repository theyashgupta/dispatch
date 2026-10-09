import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import { parseBoardKey } from "../../../shared/board-key.js";
import type {
  Board,
  BoardKey,
  OrchestratorRecord,
} from "../../../shared/types.js";
import type { HttpError } from "../domain/errors.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { DISPATCH_DATA_DIR } = await import("../../store/data-dir.js");
const { setHooksRuntime, setOrchestrationConfig } =
  await import("../infra/config-holder.js");
const tokens = await import("./orchestrator-tokens.js");
const svc = await import("./orchestrator-session.js");
const { buildLaunch, mintOrchestratorEnv } = await import("./steps.js");
const { orchestratorMcpConfigPath } =
  await import("../domain/orchestrator-launch.js");
after(() => env.cleanup());

const SBX = parseBoardKey("SBX") as BoardKey;
setOrchestrationConfig({ linearApiKey: "" });
setHooksRuntime({ capable: true, port: 4711, statusChannel: "hooks" });
await store.load();
await store.createBoard({
  key: SBX,
  name: "Sandbox",
  workspaceRoot: "/sbx/sessions",
  repositories: [],
  linearTeamKeys: [],
});
const a = await store.createLocalCard(SBX, "member a", "");
const b = await store.createLocalCard(SBX, "member b", "");
const made = await store.createGroupCard(SBX, "infra", [a.id, b.id]);
if (!made.ok) throw new Error("group not created");
const group = made.card;
const loose = await store.createLocalCard(SBX, "loose", "");
await store.setBoardPolicy(SBX, {
  ...(store.getBoard(SBX) as Board).policy,
  supervisor: "on",
  orchestratorModel: "opus",
});

const board = () => store.getBoard(SBX) as Board;
const record = (id: string) =>
  board().orchestrators.find((r) => r.id === id) as OrchestratorRecord;
const main = { id: "lead", name: "Lead", role: "main" as const };
const empty = { groupIds: [], ticketIds: [] };

const calls: string[] = [];
const started: {
  cardId: string;
  direction: string;
  playbook: string | undefined;
}[] = [];
svc.orchestratorTools.mcpCommand = () => ({
  command: "/node",
  args: ["--import", "tsx", "/app/cli.ts", "mcp"],
});
svc.orchestratorTools.start = async (cardId, direction, _config, opts) => {
  started.push({ cardId, direction, playbook: opts?.playbook });
  await store.completeStart(cardId, undefined, {
    workspacePath: `/sbx/sessions/${cardId}`,
    branch: cardId,
    tmuxSession: `dsp-${cardId}`,
  });
};
svc.orchestratorTools.keys = (target, keys) => {
  calls.push(`keys ${target} ${keys.join(",")}`);
  return Promise.resolve();
};
svc.orchestratorTools.send = (_card, _session, text) => {
  calls.push(`send ${text}`);
  return Promise.resolve("confirmed");
};
svc.orchestratorTools.atPrompt = () => Promise.resolve(true);
svc.orchestratorTools.hasSession = () => Promise.resolve(true);
svc.orchestratorTools.relaunch = (cardId) => {
  calls.push(`relaunch ${cardId}`);
  return Promise.resolve("launched");
};
svc.orchestratorTools.stopWait = { totalMs: 50, pollMs: 5 };

async function refused(
  work: Promise<unknown>,
  status: number,
  code: string,
): Promise<HttpError> {
  const err = await work.then(
    () => assert.fail("expected a refusal"),
    (e: unknown) => e as HttpError,
  );
  assert.equal(err.status, status);
  assert.equal(err.code, code);
  return err;
}

void test("add runs the ownership rules and maps each refusal to its status", async () => {
  await svc.addOrchestrator(board(), {
    ...main,
    scope: empty,
    policyOverride: {},
  });
  assert.equal(record("lead").state, "stopped");
  assert.equal(record("lead").cardId, null);
  await refused(
    svc.addOrchestrator(board(), {
      ...main,
      id: "other",
      scope: empty,
      policyOverride: {},
    }),
    409,
    "main-exists",
  );
  await refused(
    svc.addOrchestrator(board(), {
      ...main,
      role: "extra",
      scope: { groupIds: [group.id], ticketIds: [] },
      policyOverride: {},
    }),
    409,
    "duplicate-id",
  );
  await refused(
    svc.addOrchestrator(board(), {
      id: "infra",
      name: "Infra",
      role: "extra",
      scope: empty,
      policyOverride: {},
    }),
    400,
    "extra-needs-scope",
  );
  await refused(
    svc.addOrchestrator(board(), {
      id: "infra",
      name: "Infra",
      role: "extra",
      scope: { groupIds: ["NOPE-1"], ticketIds: [] },
      policyOverride: {},
    }),
    400,
    "unknown-card",
  );
  await refused(
    svc.addOrchestrator(board(), {
      id: "infra",
      name: "Infra",
      role: "extra",
      scope: { groupIds: [loose.id], ticketIds: [] },
      policyOverride: {},
    }),
    400,
    "unknown-card",
  );
  await refused(
    svc.addOrchestrator(board(), {
      id: "infra",
      name: "Infra",
      role: "extra",
      scope: empty,
      policyOverride: { concurrencyCap: 99 },
    }),
    400,
    "extra-needs-scope",
  );
});

void test("a group in the scope of one extra is refused for a second, with the owner in the details", async () => {
  await svc.addOrchestrator(board(), {
    id: "infra",
    name: "Infra",
    role: "extra",
    scope: { groupIds: [group.id], ticketIds: [loose.id] },
    policyOverride: { shipRights: "none" },
  });
  const err = await refused(
    svc.addOrchestrator(board(), {
      id: "second",
      name: "Second",
      role: "extra",
      scope: { groupIds: [group.id], ticketIds: [] },
      policyOverride: {},
    }),
    409,
    "group-owned",
  );
  assert.deepEqual(err.details, { owner: "infra" });
});

void test("edit changes the scope and refuses a scope or override the rules refuse", async () => {
  const next = await svc.editOrchestrator(board(), "infra", {
    name: "Infra team",
    policyOverride: { concurrencyCap: 1 },
  });
  assert.equal(next.name, "Infra team");
  assert.equal(record("infra").policyOverride.concurrencyCap, 1);
  await refused(
    svc.editOrchestrator(board(), "lead", {
      scope: { groupIds: [group.id], ticketIds: [] },
    }),
    400,
    "main-has-scope",
  );
  await refused(
    svc.editOrchestrator(board(), "ghost", { name: "x" }),
    404,
    "unknown-orchestrator",
  );
});

void test("start is refused with supervisor off and writes nothing", async () => {
  const policy = board().policy;
  await store.setBoardPolicy(SBX, { ...policy, supervisor: "off" });
  const err = await refused(
    svc.startOrchestrator(board(), "lead"),
    403,
    "policy-refused",
  );
  assert.equal(err.details?.reason, "supervisor-off");
  assert.equal(record("lead").cardId, null);
  assert.equal(record("lead").state, "stopped");
  await store.setBoardPolicy(SBX, policy);
});

void test("start makes the hidden card, writes the mcp config and ends running", async () => {
  const { record: first, settled } = await svc.startOrchestrator(
    board(),
    "lead",
  );
  assert.equal(first.state, "starting");
  await refused(
    svc.startOrchestrator(board(), "lead"),
    409,
    "orchestrator-running",
  );
  await refused(
    svc.removeOrchestrator(board(), "lead"),
    409,
    "orchestrator-running",
  );
  await settled;
  const stored = record("lead");
  assert.equal(stored.state, "running");
  const card = store.getCard(stored.cardId as string);
  assert.equal(card?.source, "orchestrator");
  assert.equal(card?.ownerOrchestrator, "lead");
  assert.equal(card?.title, "Orchestrator: Lead");
  assert.equal(card?.workspace, undefined);
  assert.match(started[0]?.direction ?? "", /"Lead" \(id lead\) of board SBX/);
  assert.equal(started[0]?.playbook, "Board Orchestrator");

  const file = orchestratorMcpConfigPath(DISPATCH_DATA_DIR, "SBX", "lead");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(file.replace(/[^/]+$/, "")).mode & 0o777, 0o700);
  const text = fs.readFileSync(file, "utf8");
  assert.deepEqual(JSON.parse(text), {
    mcpServers: {
      dispatch: {
        command: "/node",
        args: ["--import", "tsx", "/app/cli.ts", "mcp"],
      },
    },
  });
  assert.equal(/token/i.test(text), false);
});

void test("a start that leaves no live session ends stopped with the start error on the card", async () => {
  await svc
    .addOrchestrator(board(), {
      id: "broken",
      name: "Broken",
      role: "extra",
      scope: { groupIds: [], ticketIds: [loose.id] },
      policyOverride: {},
    })
    .catch(async () => {
      await svc.editOrchestrator(board(), "infra", {
        scope: { groupIds: [group.id], ticketIds: [] },
      });
      await svc.addOrchestrator(board(), {
        id: "broken",
        name: "Broken",
        role: "extra",
        scope: { groupIds: [], ticketIds: [loose.id] },
        policyOverride: {},
      });
    });
  const keep = svc.orchestratorTools.start;
  svc.orchestratorTools.start = async (cardId) => {
    await store.setStartError(cardId, {
      step: "starting claude",
      stderr: "boom",
      variant: "generic",
    });
  };
  const { settled } = await svc.startOrchestrator(board(), "broken");
  await settled;
  assert.equal(record("broken").state, "stopped");
  const card = store.getCard(record("broken").cardId as string);
  assert.equal(card?.startError?.step, "starting claude");
  assert.equal(
    svc.listOrchestrators(board()).find((o) => o.id === "broken")?.session
      ?.startError,
    "starting claude: boom",
  );
  svc.orchestratorTools.start = keep;
});

void test("list shows the hidden card session view", () => {
  const view = svc.listOrchestrators(board()).find((o) => o.id === "lead");
  assert.equal(view?.session?.cardId, record("lead").cardId);
  assert.equal(view?.session?.hasTmuxSession, true);
  assert.equal(
    view?.session?.activeSessionId,
    store.getCard(record("lead").cardId!)?.activeSessionId ?? null,
  );
  assert.equal(view?.session?.startError, null);
  assert.equal("stateMarkdown" in (view ?? {}), false);
  assert.equal(
    svc.listOrchestrators(board()).find((o) => o.id === "infra")?.session,
    null,
  );
});

void test("stop sends one Escape and /exit, revokes the token and never kills", async () => {
  const identity = { boardKey: SBX, orchestratorId: "lead" };
  const token = tokens.mintOrchestratorToken(identity);
  calls.length = 0;
  const { record: stopping, settled } = await svc.stopOrchestrator(
    board(),
    "lead",
  );
  assert.equal(stopping.state, "stopping");
  await settled;
  const tmux = `dsp-${record("lead").cardId}`;
  assert.deepEqual(calls, [`keys =${tmux}: Escape`, "send /exit"]);
  assert.equal(record("lead").state, "stopped");
  assert.equal(tokens.resolveOrchestratorToken(token)?.revoked, true);
  assert.equal(
    Object.keys(svc.orchestratorTools).some((k) => /kill/i.test(k)),
    false,
  );
  const source = fs.readFileSync(
    new URL("./orchestrator-session.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    /killSession|kill-server|process\.kill|\.kill\(/.test(source),
    false,
    "the session service holds no kill call",
  );
  await refused(
    svc.stopOrchestrator(board(), "lead"),
    409,
    "orchestrator-not-running",
  );
});

void test("resume relaunches in place when the tmux session lives, else runs the saga again", async () => {
  calls.length = 0;
  started.length = 0;
  const inPlace = await svc.resumeOrchestrator(board(), "lead");
  await inPlace.settled;
  assert.deepEqual(calls, [`relaunch ${record("lead").cardId}`]);
  assert.equal(started.length, 0);
  assert.equal(record("lead").state, "running");

  const stop = await svc.stopOrchestrator(board(), "lead");
  await stop.settled;
  svc.orchestratorTools.hasSession = () => Promise.resolve(false);
  const again = await svc.resumeOrchestrator(board(), "lead");
  await again.settled;
  assert.equal(started.length, 1);
  assert.equal(started[0]?.playbook, "Board Orchestrator");
  assert.equal(record("lead").state, "running");
  await refused(
    svc.resumeOrchestrator(board(), "lead"),
    409,
    "orchestrator-not-resumable",
  );
  svc.orchestratorTools.hasSession = () => Promise.resolve(true);
});

void test("a resume whose in place relaunch is refused as busy ends stopped, never running", async () => {
  const stop = await svc.stopOrchestrator(board(), "lead");
  await stop.settled;
  assert.equal(record("lead").state, "stopped");
  const keep = svc.orchestratorTools.relaunch;
  svc.orchestratorTools.relaunch = () => Promise.resolve("busy");
  const busy = await svc.resumeOrchestrator(board(), "lead");
  await busy.settled;
  assert.equal(record("lead").state, "stopped");
  svc.orchestratorTools.relaunch = keep;
  const again = await svc.resumeOrchestrator(board(), "lead");
  await again.settled;
  assert.equal(record("lead").state, "running");
});

void test("start of a stopped orchestrator whose session is still open is refused and points to resume", async () => {
  const stop = await svc.stopOrchestrator(board(), "lead");
  await stop.settled;
  assert.equal(record("lead").state, "stopped");
  calls.length = 0;
  started.length = 0;
  const err = await refused(
    svc.startOrchestrator(board(), "lead"),
    409,
    "orchestrator-session-live",
  );
  assert.equal(err.details?.reason, "the session is still open: resume it");
  assert.equal(record("lead").state, "stopped");
  assert.deepEqual(calls, []);
  assert.equal(started.length, 0);
  const again = await svc.resumeOrchestrator(board(), "lead");
  await again.settled;
  assert.equal(record("lead").state, "running");
});

void test("remove refuses the main while an extra exists and removes a stopped extra", async () => {
  await refused(
    svc.removeOrchestrator(board(), "lead"),
    409,
    "orchestrator-running",
  );
  const stop = await svc.stopOrchestrator(board(), "lead");
  await stop.settled;
  await refused(
    svc.removeOrchestrator(board(), "lead"),
    400,
    "extra-needs-main",
  );
  const brokenTmux = `=dsp-${record("broken").cardId}`;
  svc.orchestratorTools.hasSession = (target) =>
    Promise.resolve(target !== brokenTmux);
  try {
    await svc.removeOrchestrator(board(), "broken");
  } finally {
    svc.orchestratorTools.hasSession = () => Promise.resolve(true);
  }
  assert.equal(
    board().orchestrators.some((r) => r.id === "broken"),
    false,
  );
});

void test("the launch of an orchestrator card carries the policy flags and never a bypass flag", async () => {
  const card = store.getCard(record("lead").cardId as string)!;
  const { argv } = await buildLaunch(
    { id: "default", label: "Default" } as never,
    ["--resume", "abc"],
    null,
    card,
  );
  const mcp = orchestratorMcpConfigPath(DISPATCH_DATA_DIR, "SBX", "lead");
  assert.deepEqual(argv.slice(1, 20), [
    "--model",
    "opus",
    "--mcp-config",
    mcp,
    "--strict-mcp-config",
    "--tools",
    "Read",
    "Glob",
    "Grep",
    "--allowedTools",
    "mcp__dispatch",
    "--permission-mode",
    "manual",
    "--disallowedTools",
    "Bash",
    "Write",
    "Edit",
    "NotebookEdit",
    "--resume",
  ]);
  assert.equal(
    argv.some((a) => a.includes("dangerously")),
    false,
  );
  const plain = await buildLaunch(
    { id: "default", label: "Default" } as never,
    [],
    null,
    loose,
  );
  assert.ok(plain.argv.includes("--dangerously-skip-permissions"));
  assert.equal(plain.argv.includes("--mcp-config"), false);
});

void test("the launch of a group card carries the policy loop model and drops the Settings model", async () => {
  const account = { id: "default", label: "Default" } as never;
  const policy = board().policy;
  const launch = async () =>
    (await buildLaunch(account, [], null, store.getCard(group.id))).argv;
  assert.equal((await launch()).includes("--effort"), false);
  await store.setBoardPolicy(SBX, {
    ...policy,
    loopModel: "claude-sonnet-5-5:high",
  });
  try {
    const argv = await launch();
    const at = argv.indexOf("--model");
    assert.deepEqual(argv.slice(at, at + 4), [
      "--model",
      "claude-sonnet-5-5",
      "--effort",
      "high",
    ]);
    assert.equal(argv.indexOf("--model"), argv.lastIndexOf("--model"));
    const ticket = (await buildLaunch(account, [], null, loose)).argv;
    assert.equal(ticket.includes("claude-sonnet-5-5"), false);
  } finally {
    await store.setBoardPolicy(SBX, policy);
  }
});

void test("a session created for an orchestrator card gets a fresh token and the port, and the old token dies", () => {
  const card = store.getCard(record("lead").cardId as string)!;
  const first = mintOrchestratorEnv(card);
  assert.equal(first.DISPATCH_PORT, "4711");
  const second = mintOrchestratorEnv(card);
  const token = (env: Record<string, string>) =>
    env.DISPATCH_ORCHESTRATOR_TOKEN;
  assert.notEqual(token(first), token(second));
  assert.equal(tokens.resolveOrchestratorToken(token(first))?.revoked, true);
  assert.deepEqual(tokens.resolveOrchestratorToken(token(second)), {
    boardKey: SBX,
    orchestratorId: "lead",
    revoked: false,
  });
});

void test("start and resume with no loaded config are refused before any record or card write", async () => {
  const cards = store.listAllCards(SBX).length;
  setOrchestrationConfig(null as never);
  try {
    await refused(
      svc.startOrchestrator(board(), "infra"),
      400,
      "orchestration config is not loaded",
    );
    await refused(
      svc.resumeOrchestrator(board(), "lead"),
      400,
      "orchestration config is not loaded",
    );
  } finally {
    setOrchestrationConfig({ linearApiKey: "" });
  }
  assert.equal(record("infra").state, "stopped");
  assert.equal(record("infra").cardId, null);
  assert.equal(record("lead").state, "stopped");
  assert.equal(store.listAllCards(SBX).length, cards);
});

void test("the boot settle moves a transient record to running while its tmux session is open, else to stopped with its token revoked", async () => {
  const leadCard = record("lead").cardId;
  assert.ok(leadCard);
  const leadTmux = store.getCard(leadCard)?.tmuxSession;
  assert.ok(leadTmux);
  const setStates = (lead: "starting" | "stopping") =>
    store.setBoardOrchestrators(
      SBX,
      board().orchestrators.map((r) =>
        r.id === "infra"
          ? { ...r, state: "starting" as const }
          : { ...r, state: lead },
      ),
    );
  const infraToken = tokens.mintOrchestratorToken({
    boardKey: SBX,
    orchestratorId: "infra",
  });
  const leadToken = tokens.mintOrchestratorToken({
    boardKey: SBX,
    orchestratorId: "lead",
  });
  const seen: string[] = [];
  svc.orchestratorTools.hasSession = (target) => {
    seen.push(target);
    return Promise.resolve(target === `=${leadTmux}`);
  };
  try {
    await setStates("starting");
    assert.equal(await svc.settleTransientRecords(), 2);
    assert.deepEqual(seen, [`=${leadTmux}`]);
    assert.equal(record("infra").state, "stopped");
    assert.equal(record("lead").state, "running");
    assert.equal(tokens.resolveOrchestratorToken(infraToken)?.revoked, true);
    assert.equal(tokens.resolveOrchestratorToken(leadToken)?.revoked, false);
    svc.orchestratorTools.hasSession = () => Promise.resolve(false);
    await setStates("stopping");
    assert.equal(await svc.settleTransientRecords(), 2);
    assert.equal(record("lead").state, "stopped");
    assert.equal(tokens.resolveOrchestratorToken(leadToken)?.revoked, true);
    assert.equal(await svc.settleTransientRecords(), 0);
  } finally {
    svc.orchestratorTools.hasSession = () => Promise.resolve(true);
  }
});

void test("two record writes at once both land", async () => {
  await Promise.all([
    svc.writeState({ boardKey: SBX, orchestratorId: "lead" }, "plan A", false),
    svc.editOrchestrator(board(), "infra", { name: "Infra two" }),
    svc.setHandoffReady(SBX, "infra", true),
  ]);
  assert.equal(record("lead").stateMarkdown, "plan A");
  assert.equal(record("infra").name, "Infra two");
  assert.equal(record("infra").handoffReady, true);
});

void test("resume takes a running record whose session is back at the shell, and refuses a working one", async () => {
  const first = await svc.resumeOrchestrator(board(), "lead");
  await first.settled;
  assert.equal(record("lead").state, "running");
  const card = store.getCard(record("lead").cardId as string)!;
  await store.setSessionStateIfSession(
    card.id,
    card.activeSessionId as string,
    "working",
  );
  await refused(
    svc.resumeOrchestrator(board(), "lead"),
    409,
    "orchestrator-not-resumable",
  );
  await store.setSessionStateIfSession(
    card.id,
    card.activeSessionId as string,
    "shell_prompt",
  );
  calls.length = 0;
  const again = await svc.resumeOrchestrator(board(), "lead");
  assert.equal(again.record.state, "starting");
  await again.settled;
  assert.deepEqual(calls, [`relaunch ${card.id}`]);
  assert.equal(record("lead").state, "running");
});

void test("resume takes a running record whose card is session lost, or whose session state is lost", async () => {
  const working = async (): Promise<string> => {
    const card = store.getCard(record("lead").cardId as string)!;
    await store.setSessionStateIfSession(
      card.id,
      card.activeSessionId as string,
      "working",
    );
    await refused(
      svc.resumeOrchestrator(board(), "lead"),
      409,
      "orchestrator-not-resumable",
    );
    return card.id;
  };
  assert.equal(record("lead").state, "running");

  const lostCard = await working();
  await store.markSessionLost(lostCard, undefined);
  assert.equal(store.getCard(lostCard)?.sessionLost, true);
  started.length = 0;
  const fromLost = await svc.resumeOrchestrator(board(), "lead");
  assert.equal(fromLost.record.state, "starting");
  await fromLost.settled;
  assert.equal(started.length, 1);
  assert.equal(record("lead").state, "running");

  const stateCard = await working();
  assert.notEqual(store.getCard(stateCard)?.sessionLost, true);
  await store.setSessionStateIfSession(
    stateCard,
    store.getCard(stateCard)?.activeSessionId as string,
    "lost",
  );
  calls.length = 0;
  const fromState = await svc.resumeOrchestrator(board(), "lead");
  assert.equal(fromState.record.state, "starting");
  await fromState.settled;
  assert.deepEqual(calls, [`relaunch ${stateCard}`]);
  assert.equal(record("lead").state, "running");
});

void test("a stop that cannot see the shell prompt while the session lives stays running with its token", async () => {
  const token = tokens.mintOrchestratorToken({
    boardKey: SBX,
    orchestratorId: "lead",
  });
  svc.orchestratorTools.atPrompt = () => Promise.resolve(false);
  try {
    const stuck = await svc.stopOrchestrator(board(), "lead");
    await stuck.settled;
    assert.equal(record("lead").state, "running");
    assert.equal(tokens.resolveOrchestratorToken(token)?.revoked, false);
    svc.orchestratorTools.hasSession = () => Promise.resolve(false);
    const gone = await svc.stopOrchestrator(board(), "lead");
    await gone.settled;
    assert.equal(record("lead").state, "stopped");
    assert.equal(tokens.resolveOrchestratorToken(token)?.revoked, true);
  } finally {
    svc.orchestratorTools.atPrompt = () => Promise.resolve(true);
    svc.orchestratorTools.hasSession = () => Promise.resolve(true);
  }
});

void test("remove is refused while the hidden card session is open, and revokes the token after", async () => {
  const start = await svc.startOrchestrator(board(), "infra");
  await start.settled;
  const stop = await svc.stopOrchestrator(board(), "infra");
  await stop.settled;
  assert.equal(record("infra").state, "stopped");
  const token = tokens.mintOrchestratorToken({
    boardKey: SBX,
    orchestratorId: "infra",
  });
  const err = await refused(
    svc.removeOrchestrator(board(), "infra"),
    409,
    "orchestrator-session-live",
  );
  assert.equal(
    err.details?.reason,
    "the session is still open: exit its shell first",
  );
  svc.orchestratorTools.hasSession = () => Promise.resolve(false);
  try {
    await svc.removeOrchestrator(board(), "infra");
  } finally {
    svc.orchestratorTools.hasSession = () => Promise.resolve(true);
  }
  assert.equal(
    board().orchestrators.some((r) => r.id === "infra"),
    false,
  );
  assert.equal(tokens.resolveOrchestratorToken(token)?.revoked, true);
});

/** Write the state of one record straight to the store, as a test setup step. */
async function setRecord(
  id: string,
  patch: Partial<OrchestratorRecord>,
): Promise<void> {
  await store.setBoardOrchestrators(
    SBX,
    board().orchestrators.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  );
}

void test("a resume that finds another launch of the same session in flight keeps the record running and its token", async () => {
  await setRecord("lead", { state: "running" });
  const card = store.getCard(record("lead").cardId as string)!;
  await store.setSessionStateIfSession(
    card.id,
    card.activeSessionId as string,
    "shell_prompt",
  );
  const token = tokens.mintOrchestratorToken({
    boardKey: SBX,
    orchestratorId: "lead",
  });
  const keep = svc.orchestratorTools.relaunch;
  svc.orchestratorTools.relaunch = () => Promise.resolve("busy");
  try {
    const raced = await svc.resumeOrchestrator(board(), "lead");
    assert.equal(raced.record.state, "starting");
    await raced.settled;
  } finally {
    svc.orchestratorTools.relaunch = keep;
  }
  assert.equal(record("lead").state, "running");
  assert.equal(tokens.resolveOrchestratorToken(token)?.revoked, false);
});

void test("a start that never becomes ready settles stopped and revokes the token it minted", async () => {
  await setRecord("lead", { state: "stopped" });
  let minted = "";
  const keep = svc.orchestratorTools.start;
  svc.orchestratorTools.start = async (cardId) => {
    minted = tokens.mintOrchestratorToken({
      boardKey: SBX,
      orchestratorId: "lead",
    });
    await store.setStartError(cardId, {
      step: "starting claude",
      stderr: "never ready",
      variant: "repl-timeout",
    });
  };
  svc.orchestratorTools.hasSession = () => Promise.resolve(false);
  try {
    const { settled } = await svc.startOrchestrator(board(), "lead");
    await settled;
  } finally {
    svc.orchestratorTools.start = keep;
    svc.orchestratorTools.hasSession = () => Promise.resolve(true);
  }
  assert.equal(record("lead").state, "stopped");
  assert.ok(minted);
  assert.equal(tokens.resolveOrchestratorToken(minted)?.revoked, true);
});

void test("the boot settle of a first start finds the open session by the name the launch uses before the card holds it", async () => {
  const kept = record("lead").cardId;
  const fresh = await store.createOrchestratorCard(
    SBX,
    "Orchestrator: Lead",
    "lead",
  );
  assert.equal(fresh.tmuxSession, undefined);
  await setRecord("lead", { cardId: fresh.id, state: "starting" });
  const token = tokens.mintOrchestratorToken({
    boardKey: SBX,
    orchestratorId: "lead",
  });
  const seen: string[] = [];
  svc.orchestratorTools.hasSession = (target) => {
    seen.push(target);
    return Promise.resolve(target === `=dsp-${fresh.identifier}`);
  };
  try {
    assert.equal(await svc.settleTransientRecords(), 1);
    assert.deepEqual(seen, [`=dsp-${fresh.identifier}`]);
    assert.equal(record("lead").state, "running");
    assert.equal(tokens.resolveOrchestratorToken(token)?.revoked, false);
    svc.orchestratorTools.hasSession = () => Promise.resolve(false);
    await setRecord("lead", { state: "starting" });
    assert.equal(await svc.settleTransientRecords(), 1);
    assert.equal(record("lead").state, "stopped");
    assert.equal(tokens.resolveOrchestratorToken(token)?.revoked, true);
  } finally {
    svc.orchestratorTools.hasSession = () => Promise.resolve(true);
    await setRecord("lead", { cardId: kept, state: "stopped" });
  }
});

void test("a start whose mcp config write fails leaves the record stopped with the start error on its linked card", async () => {
  const ticket = await store.createLocalCard(SBX, "locked out ticket", "");
  await svc.addOrchestrator(board(), {
    id: "lockedout",
    name: "Locked out",
    role: "extra",
    scope: { groupIds: [], ticketIds: [ticket.id] },
    policyOverride: {},
  });
  const dir = path.dirname(
    orchestratorMcpConfigPath(DISPATCH_DATA_DIR, SBX, "lockedout"),
  );
  fs.mkdirSync(dir, { recursive: true });
  const cards = store.listAllCards(SBX).length;
  fs.chmodSync(dir, 0o000);
  try {
    await assert.rejects(svc.startOrchestrator(board(), "lockedout"), {
      code: "EACCES",
    });
  } finally {
    fs.chmodSync(dir, 0o700);
  }
  assert.equal(record("lockedout").state, "stopped");
  const cardId = record("lockedout").cardId;
  assert.ok(cardId);
  assert.equal(store.listAllCards(SBX).length, cards + 1);
  assert.equal(store.getCard(cardId)?.startError?.step, "writing mcp config");
  svc.orchestratorTools.hasSession = () => Promise.resolve(false);
  try {
    const again = await svc.startOrchestrator(board(), "lockedout");
    assert.equal(again.record.cardId, cardId);
    await again.settled;
  } finally {
    svc.orchestratorTools.hasSession = () => Promise.resolve(true);
  }
  assert.equal(record("lockedout").state, "running");
  assert.equal(store.listAllCards(SBX).length, cards + 1);
});
