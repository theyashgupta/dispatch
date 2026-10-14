import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Card, LoopProgress } from "../../src/shared/types.js";
import {
  git,
  makeSampleRepo,
  type SampleRepo,
} from "./fixtures/scenario-1/repo.js";
import { passLine, type LoopSpec } from "./fixtures/scenario-1/loop-files.js";
import { readyRows } from "./fixtures/scenario-1/status-rows.js";
import { cardOf, readJsonl, writeRunLog } from "./harness/board-reads.js";
import {
  EVIDENCE_DIR,
  MINUTE,
  makeNote,
  sleep,
  startSandbox,
  waitFor,
  type Sandbox,
} from "./harness/sandbox.js";

const BOARD = "SHO";
const QUICK_FIX = "SHO-1";
const FEATURE = "SHO-2";
const RELATED = ["SHO-3", "SHO-4"];
const ORCHESTRATOR_CARD = "SHO-5";
const GROUP_ID = "SHO-6";
const CAP = 3;
const RUN_LOG = path.join(EVIDENCE_DIR, "scenario-6b-run-log.txt");
const WAKE_PREFIX = "Dispatch wake:";
const DONE_MESSAGE = "DISPATCH_STATUS: DONE - built";
const SHIP_BODY =
  "What\nThe work of the card.\nWhy\nThe card is done.\nHow\nShipped by the test.";
const PRD_REL = "sample-app/.planning/prds/export.md";
const STATE_REL = "sample-app/.planning/export/state.md";
const ENGINE_REL = ".claude/ralph-loop.local.md";

const note = makeNote("scenario-6b");

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
}

interface Received {
  text: string;
  at: number;
}

interface CapWatch {
  stop: () => Promise<number>;
}

interface Shipment {
  id: string;
  title: string;
  file: string;
}

/**
 * Post the Stop hook event that a real session sends when its last message holds a status marker.
 *
 * @remarks The sandbox uses the hooks status channel, so the pane marker alone does not move a card. The token is
 * read from the tmux session environment, the same place the hook script of a real session reads it.
 */
async function postHook(
  sb: Sandbox,
  session: string,
  body: Record<string, unknown>,
): Promise<void> {
  const line = sb.tmux([
    "show-environment",
    "-t",
    `=${session}`,
    "DISPATCH_HOOK_TOKEN",
  ]);
  const token = line.trim().replace(/^DISPATCH_HOOK_TOKEN=/, "");
  assert.notEqual(token, "", "the session carries a hook token");
  const res = await fetch(`${sb.url}/api/hook/claude`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dispatch-token": token },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 204);
}

const sendStopHook = (sb: Sandbox, session: string): Promise<void> =>
  postHook(sb, session, {
    hook_event_name: "Stop",
    last_assistant_message: DONE_MESSAGE,
  });

const worktreeOf = (card: Card, sample: SampleRepo): string =>
  path.join(card.workspacePath ?? "", sample.name);

/** The cards that hold a cap slot: a group or a launched card with a live session that is not in Agent done. */
const slotHolders = (cards: Card[]): Card[] =>
  cards.filter(
    (c) =>
      (c.source === "group" || c.launch !== undefined) &&
      c.tmuxSession !== undefined &&
      c.column !== "agent_done",
  );

/** Poll the board every 300 ms and keep the highest count of slot holders that it saw. */
function watchCap(sb: Sandbox): CapWatch {
  let running = true;
  let highest = 0;
  const loop = (async () => {
    while (running) {
      const board = await sb
        .api<{ cards: Card[] }>("GET", `/api/board?board=${BOARD}`)
        .catch(() => null);
      if (board) {
        highest = Math.max(highest, slotHolders(board.body.cards).length);
      }
      await sleep(300);
    }
  })();
  return {
    stop: async () => {
      running = false;
      await loop;
      return highest;
    },
  };
}

function receivedLines(transcript: string): Received[] {
  return readJsonl(transcript)
    .filter((e) => e.type === "user")
    .map((e) => ({
      text: String((e.message as { content: unknown }).content),
      at: Date.parse(String(e.timestamp)),
    }));
}

const wakeLinesNaming = (transcript: string, id: string): Received[] =>
  receivedLines(transcript).filter(
    (l) => l.text.startsWith(WAKE_PREFIX) && l.text.includes(id),
  );

async function orch<T = Record<string, unknown>>(
  sb: Sandbox,
  token: string,
  method: string,
  route: string,
  body?: unknown,
): Promise<Reply<T>> {
  const res = await fetch(`${sb.url}/api/orchestrator${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-orchestrator-token": token,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text === "" ? {} : JSON.parse(text)) as T,
  };
}

const awaitSession = (sb: Sandbox, id: string): Promise<Card> =>
  waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, id);
      return card?.tmuxSession !== undefined ? card : null;
    },
    4 * MINUTE,
    `the session of ${id}`,
  );

async function setup(sb: Sandbox): Promise<SampleRepo> {
  const sample = makeSampleRepo(sb.root, sb.home);
  fs.writeFileSync(
    path.join(sample.repo, "package.json"),
    `${JSON.stringify({ name: "sample-app", version: "1.2.3" })}\n`,
  );
  git(sample.repo, sb.home, ["add", "package.json"]);
  git(sample.repo, sb.home, ["commit", "-q", "-m", "chore: add package.json"]);
  git(sample.repo, sb.home, ["push", "-q", "origin", "main"]);

  const sessions = path.join(sb.workspaces, "sho-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Ship order board",
    workspaceRoot: sessions,
    repositories: [
      { path: sample.repo, baseBranch: "main", checkCommand: "true" },
    ],
  });
  assert.equal(board.status, 201);
  const policy = await sb.api("PUT", `/api/boards/${BOARD}/policy`, {
    roadmapApproval: "all",
    concurrencyCap: CAP,
    loopModel: "claude-sonnet-5-5:high",
    orchestratorModel: "claude-sonnet-5-5",
    handoffPercent: 50,
    handoffHardPercent: 80,
    usageLimit: "stop",
    shipRights: "merge",
    budgetPerGroup: null,
    supervisor: "on",
    groupPlaybook: null,
  });
  assert.equal(policy.status, 200);
  const tickets: string[] = [];
  const specs = [
    ["Fix the typo in the footer", "One known fix of a few lines."],
    ["Add the export button", "One feature of one module."],
    ["Add the report model", "First of two related tickets."],
    ["Add the report page", "Second of two related tickets, same files."],
  ];
  for (const [title, description] of specs) {
    const made = await sb.api<{ id: string }>(
      "POST",
      `/api/cards?board=${BOARD}`,
      { title, description },
    );
    assert.equal(made.status, 201);
    tickets.push(made.body.id);
  }
  assert.deepEqual(tickets, [QUICK_FIX, FEATURE, ...RELATED]);
  const added = await sb.api("POST", `/api/boards/${BOARD}/orchestrators`, {
    id: "main",
    name: "Main",
    role: "main",
  });
  assert.equal(added.status, 201);
  return sample;
}

/**
 * Mint the orchestrator token after the start.
 *
 * @remarks The start mints the token of the real session and revokes an earlier one, so a token minted before the start answers 401.
 */
async function mintToken(sb: Sandbox): Promise<string> {
  const minted = await sb.api<{ token: string }>(
    "POST",
    `/api/boards/${BOARD}/orchestrators/main/token`,
  );
  assert.equal(minted.status, 201);
  assert.notEqual(minted.body.token, "");
  return minted.body.token;
}

function writeScenarios(sb: Sandbox): string {
  const transcript = path.join(sb.logs, "orchestrator.jsonl");
  fs.writeFileSync(transcript, "");
  for (const id of [QUICK_FIX, FEATURE, GROUP_ID]) {
    fs.writeFileSync(
      path.join(sb.scenarios, `${id}.json`),
      JSON.stringify({ statusRows: readyRows(), reply: "ok" }),
    );
  }
  fs.writeFileSync(
    path.join(sb.scenarios, `${ORCHESTRATOR_CARD}.json`),
    JSON.stringify({
      statusRows: readyRows(),
      reply: "ok",
      transcriptPath: transcript,
    }),
  );
  return transcript;
}

async function startOrchestrator(
  sb: Sandbox,
  transcript: string,
): Promise<void> {
  const start = await sb.api(
    "POST",
    `/api/boards/${BOARD}/orchestrators/main/start`,
  );
  assert.equal(start.status, 202);
  const session = await waitFor(
    () =>
      sb
        .tmux(["list-sessions", "-F", "#{session_name}"])
        .split("\n")
        .filter((n) => n !== "")
        .find(
          (n) =>
            sb
              .tmux(["show-environment", "-t", `=${n}`, "DISPATCH_CARD_ID"])
              .trim() === `DISPATCH_CARD_ID=${ORCHESTRATOR_CARD}`,
        ),
    MINUTE,
    "the tmux session of the orchestrator card",
  );
  await postHook(sb, session, {
    hook_event_name: "SessionStart",
    session_id: "orchestrator",
    transcript_path: transcript,
  });
  note("orchestrator started and its transcript reported");
}

/** Start the quick fix card, the feature card and the group, and answer the group card id. */
async function startWork(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
): Promise<string> {
  const quick = await orch(sb, token, "POST", `/cards/${QUICK_FIX}/start`, {
    playbook: "Write code directly",
    direction: "Fix it.",
  });
  assert.equal(quick.status, 202);
  await awaitSession(sb, QUICK_FIX);
  const feature = await orch(sb, token, "POST", `/cards/${FEATURE}/start`, {
    playbook: "PRD + Ralph Loop",
    direction: "Build it.",
    account: "default",
  });
  assert.equal(feature.status, 202);
  await awaitSession(sb, FEATURE);
  note("quick fix and feature started");

  const created = await orch<{ card: Card }>(sb, token, "POST", "/groups", {
    title: "Report group",
    memberIds: RELATED,
    repos: [{ path: sample.repo, base: "main" }],
    direction: "Build both.",
  });
  assert.equal(created.status, 201);
  const groupId = created.body.card.id;
  assert.equal(groupId, GROUP_ID);
  const started = await orch(sb, token, "POST", `/groups/${groupId}/start`);
  assert.equal(started.status, 202);
  await awaitSession(sb, groupId);
  note(`group ${groupId} started`);
  return groupId;
}

const shipBody = (sample: SampleRepo, id: string, title: string) => ({
  repository: sample.repo,
  branches: [{ name: id, title, body: SHIP_BODY }],
});

async function assertShipRefusedWhileRunning(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
): Promise<void> {
  const refused = await orch<{ error: string }>(
    sb,
    token,
    "POST",
    `/groups/${FEATURE}/ship`,
    shipBody(sample, FEATURE, "feat: export SHO-2"),
  );
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "card-not-done");
  const card = await cardOf(sb, BOARD, FEATURE);
  assert.equal(card?.shipFlow, undefined);
  note("ship of the running feature card refused with card-not-done");
}

function commitWork(
  sb: Sandbox,
  sample: SampleRepo,
  card: Card,
  file: string,
  subject: string,
): void {
  const worktree = worktreeOf(card, sample);
  assert.equal(
    git(worktree, sb.home, ["rev-parse", "--abbrev-ref", "HEAD"]),
    card.identifier,
  );
  fs.writeFileSync(path.join(worktree, file), `${file}\n`);
  git(worktree, sb.home, ["add", file]);
  git(worktree, sb.home, ["commit", "-q", "-m", subject]);
}

function seedFeatureLoop(card: Card): void {
  const root = card.workspacePath ?? "";
  const spec: LoopSpec = {
    slug: "export",
    title: "Export",
    ticket: FEATURE,
    branch: FEATURE,
    repoDir: "sample-app",
    phases: ["Build export", "Add button"],
    clock: () => new Date().toISOString(),
  };
  const write = (rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write(
    PRD_REL,
    [
      "# Export PRD",
      "",
      ...spec.phases.flatMap((name, i) => [
        `### Phase ${i + 1}: ${name}`,
        "- **Retry budget:** 2",
        "",
      ]),
    ].join("\n"),
  );
  const at = new Date().toISOString();
  write(STATE_REL, [1, 2].map((n) => passLine(spec, n, at)).join(""));
  write(
    ENGINE_REL,
    [
      "---",
      "active: true",
      "iteration: 1",
      "session_id: export-original",
      "max_iterations: 50",
      'completion_promise: "RALPH COMPLETE export"',
      `started_at: "${at}"`,
      "---",
      "",
      `Execute the PRD at ${PRD_REL} per the ralph-loop skill.`,
      "",
    ].join("\n"),
  );
}

const phasesPassed = (progress: LoopProgress | null | undefined): boolean => {
  const phases = progress?.units[0]?.phases ?? [];
  return phases.length === 2 && phases.every((p) => p.gate === "pass");
};

interface ProgressReply {
  cardId: string;
  loopProgress: LoopProgress | null;
}

async function finishSessions(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
  groupId: string,
): Promise<void> {
  const quick = await awaitSession(sb, QUICK_FIX);
  const feature = await awaitSession(sb, FEATURE);
  const group = await awaitSession(sb, groupId);
  commitWork(sb, sample, quick, "fix.txt", "fix: quick fix");
  commitWork(sb, sample, feature, "feature.txt", "feat: export");
  commitWork(sb, sample, group, "report.txt", "feat: report");
  seedFeatureLoop(feature);
  await waitFor(
    async () => {
      const read = await orch<ProgressReply>(
        sb,
        token,
        "GET",
        `/cards/${FEATURE}/progress`,
      );
      return phasesPassed(read.body.loopProgress);
    },
    4 * MINUTE,
    "the two feature phases with gate pass",
  );
  note("feature phases passed");
  const engine = path.join(feature.workspacePath ?? "", ENGINE_REL);
  fs.renameSync(engine, `${engine}.done`);
  await waitFor(
    async () => {
      const read = await orch<ProgressReply>(
        sb,
        token,
        "GET",
        `/cards/${FEATURE}/progress`,
      );
      return read.body.loopProgress?.engine?.closed === true;
    },
    4 * MINUTE,
    "the feature progress to show the closed engine",
  );
  note("feature engine closed");

  for (const card of [quick, feature, group]) {
    await sendStopHook(sb, card.tmuxSession ?? "");
    await waitFor(
      async () => (await cardOf(sb, BOARD, card.id))?.column === "agent_done",
      4 * MINUTE,
      `${card.id} in agent_done`,
    );
    note(`${card.id} reached agent_done`);
  }
}

async function assertFeatureWake(
  sb: Sandbox,
  token: string,
  transcript: string,
): Promise<void> {
  const rows = (await sb.orchestrationEvents(BOARD)).filter(
    (e) =>
      e.kind === "group_state" &&
      e.cardId === FEATURE &&
      e.data.state === "agent_done",
  );
  assert.equal(rows.length, 1, "one agent_done group_state row for SHO-2");
  await waitFor(
    () => wakeLinesNaming(transcript, FEATURE).length > 0,
    3 * MINUTE,
    "the wake line that names SHO-2",
    { pollMs: 1000 },
  );
  assert.equal(wakeLinesNaming(transcript, FEATURE).length, 1);
  note("one wake line names SHO-2");

  const read = await orch<ProgressReply>(
    sb,
    token,
    "GET",
    `/cards/${FEATURE}/progress`,
  );
  assert.equal(read.status, 200);
  assert.ok(phasesPassed(read.body.loopProgress));
  const dashboard = await sb.api<{ card: Card }>(
    "GET",
    `/api/cards/${FEATURE}`,
  );
  assert.equal(dashboard.status, 200);
  assert.ok(phasesPassed(dashboard.body.card.loopProgress));
}

async function shipAndWait(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
  { id, title }: Shipment,
): Promise<void> {
  const shipped = await orch(
    sb,
    token,
    "POST",
    `/groups/${id}/ship`,
    shipBody(sample, id, title),
  );
  assert.equal(shipped.status, 202, JSON.stringify(shipped.body));
  await waitFor(
    async () => {
      const read = await orch<{ flow: { state: string } }>(
        sb,
        token,
        "GET",
        `/groups/${id}/ship`,
      );
      if (read.body.flow?.state === "stopped") {
        throw new Error(`the ship of ${id} stopped`);
      }
      return read.body.flow?.state === "done";
    },
    10 * MINUTE,
    `the ship of ${id} to be done`,
    { pollMs: 1000 },
  );
  await waitFor(
    async () => (await cardOf(sb, BOARD, id))?.column === "done",
    MINUTE,
    `${id} in Done`,
  );
  note(`${id} shipped`);
}

async function shipInOrder(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
  groupId: string,
): Promise<Shipment[]> {
  const order: Shipment[] = [
    { id: QUICK_FIX, title: "fix: quick fix SHO-1", file: "fix.txt" },
    { id: FEATURE, title: "feat: export SHO-2", file: "feature.txt" },
    { id: groupId, title: `feat: report ${groupId}`, file: "report.txt" },
  ];
  for (const item of order) await shipAndWait(sb, sample, token, item);
  return order;
}

function assertShipped(
  sb: Sandbox,
  sample: SampleRepo,
  order: Shipment[],
): void {
  const calls = readJsonl(sb.gh.log).map((argv) =>
    Array.isArray(argv) ? argv.map(String) : [],
  );
  const verbs = (verb: string) =>
    calls.filter((c) => c[0] === "pr" && c[1] === verb);
  assert.deepEqual(
    verbs("create").map((c) => c[c.indexOf("--head") + 1]),
    order.map((o) => o.id),
  );
  assert.equal(verbs("merge").length, 3);
  for (const { file } of order) {
    assert.equal(
      git(sample.bare, sb.home, ["show", `main:${file}`]),
      file,
      `the bare origin main holds ${file}`,
    );
  }
  note("three PRs created and merged in plan order");
}

async function assertRelease(sb: Sandbox, token: string): Promise<void> {
  const body = {
    bump: "minor",
    features: ["Quick fix", "Export", "Report"],
    prs: [1, 2, 3],
  };
  const made = await orch<{
    cardId: string;
    version: string;
    previous: string;
  }>(sb, token, "POST", "/releases", body);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.version, "1.3.0");
  assert.equal(made.body.previous, "1.2.3");
  const card = await cardOf(sb, BOARD, made.body.cardId);
  assert.equal(card?.title, "Release v1.3.0");
  assert.equal(card?.column, "todo");
  const again = await orch<{ error: string }>(
    sb,
    token,
    "POST",
    "/releases",
    body,
  );
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "release-exists");
  note("release card created and the repeat refused");
}

/**
 * Run a board with a quick fix, a single feature and a group from their starts to the release card.
 *
 * @remarks The only inputs after the orchestrator start are orchestrator routes called with its token, the Stop hooks of the sessions, and git
 * and file writes in the session folders. The orchestrator itself only idles.
 */
async function runScenario(sb: Sandbox): Promise<void> {
  const sample = await setup(sb);
  const transcript = writeScenarios(sb);
  await startOrchestrator(sb, transcript);
  const token = await mintToken(sb);
  const watch = watchCap(sb);
  try {
    const groupId = await startWork(sb, sample, token);
    await assertShipRefusedWhileRunning(sb, sample, token);
    await finishSessions(sb, sample, token, groupId);
    await assertFeatureWake(sb, token, transcript);
    const order = await shipInOrder(sb, sample, token, groupId);
    assertShipped(sb, sample, order);
    await assertRelease(sb, token);
    assert.equal(wakeLinesNaming(transcript, FEATURE).length, 1);
  } finally {
    const highest = await watch.stop();
    note(`most loops at once: ${highest}`);
    assert.ok(highest <= CAP, `${highest} loops held a slot at once`);
  }
}

void test(
  "scenario 6 part B: a quick fix, a single feature and a group ship in plan order, and a release card gets the next version",
  { timeout: 20 * MINUTE },
  async () => {
    const sb = await startSandbox({ name: "s6b-ship-order" });
    try {
      await runScenario(sb);
    } finally {
      try {
        await writeRunLog(sb, BOARD, RUN_LOG);
      } catch (err) {
        note(
          `run log not written: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      await sb.stop();
    }
  },
);
