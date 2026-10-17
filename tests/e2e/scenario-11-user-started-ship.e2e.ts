import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Card, ShipFlow } from "../../src/shared/types.js";
import {
  git,
  makeSampleRepo,
  type SampleRepo,
} from "./fixtures/scenario-1/repo.js";
import { readyRows } from "./fixtures/scenario-1/status-rows.js";
import { cardOf, readJsonl, writeRunLog } from "./harness/board-reads.js";
import {
  EVIDENCE_DIR,
  MINUTE,
  makeNote,
  startSandbox,
  waitFor,
  type Sandbox,
} from "./harness/sandbox.js";

const BOARD = "USR";
const CARD = "USR-1";
const ORCHESTRATOR_CARD = "USR-2";
const UNSTARTED = "USR-3";
const RUN_LOG = path.join(EVIDENCE_DIR, "scenario-11-run-log.txt");
const DONE_MESSAGE = "DISPATCH_STATUS: DONE - built";
const SHIP_BODY =
  "What\nThe work of the card.\nWhy\nThe card is done.\nHow\nShipped by the test.";

const note = makeNote("scenario-11");

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
}

/**
 * Post the Stop hook event that a real session sends when its last message holds a status marker.
 *
 * @remarks The token is read from the tmux session environment, the same place the hook script of a real session reads it.
 */
async function sendStopHook(
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

/** Create the board, the ship policy with rights merge, ticket card A and the main orchestrator, and write the replay files. */
async function setup(sb: Sandbox): Promise<SampleRepo> {
  const sample = makeSampleRepo(sb.root, sb.home);
  const sessions = path.join(sb.workspaces, "usr-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "User started board",
    workspaceRoot: sessions,
    repositories: [
      { path: sample.repo, baseBranch: "main", checkCommand: "true" },
    ],
  });
  assert.equal(board.status, 201);
  const policy = await sb.api("PUT", `/api/boards/${BOARD}/policy`, {
    roadmapApproval: "all",
    concurrencyCap: 3,
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
  const made = await sb.api<{ id: string }>(
    "POST",
    `/api/cards?board=${BOARD}`,
    { title: "Add the profile page", description: "One feature of one page." },
  );
  assert.equal(made.status, 201);
  assert.equal(made.body.id, CARD);
  const added = await sb.api("POST", `/api/boards/${BOARD}/orchestrators`, {
    id: "main",
    name: "Main",
    role: "main",
  });
  assert.equal(added.status, 201);

  const transcript = path.join(sb.logs, "orchestrator.jsonl");
  fs.writeFileSync(transcript, "");
  fs.writeFileSync(
    path.join(sb.scenarios, `${CARD}.json`),
    JSON.stringify({ statusRows: readyRows(), reply: "ok" }),
  );
  fs.writeFileSync(
    path.join(sb.scenarios, `${ORCHESTRATOR_CARD}.json`),
    JSON.stringify({
      statusRows: readyRows(),
      reply: "ok",
      transcriptPath: transcript,
    }),
  );
  return sample;
}

/** Start the main orchestrator, send its SessionStart hook and return its minted token. */
async function startOrchestrator(sb: Sandbox): Promise<string> {
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
  await sendStopHook(sb, session, {
    hook_event_name: "SessionStart",
    session_id: "orchestrator",
    transcript_path: path.join(sb.logs, "orchestrator.jsonl"),
  });
  const minted = await sb.api<{ token: string }>(
    "POST",
    `/api/boards/${BOARD}/orchestrators/main/token`,
  );
  assert.equal(minted.status, 201);
  note("orchestrator started");
  return minted.body.token;
}

/** Start card A through the board route that the start dialog calls, and check that it has a session branch and no launch. */
async function startFromDialog(sb: Sandbox, sample: SampleRepo): Promise<Card> {
  const started = await sb.api("POST", `/api/cards/${CARD}/start`, {
    extraDirection: "Build it.",
    folder: path.dirname(sample.repo),
    repos: [{ path: sample.repo, base: "main" }],
  });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  const card = await waitFor(
    async () => {
      const read = await cardOf(sb, BOARD, CARD);
      return read?.tmuxSession !== undefined ? read : null;
    },
    4 * MINUTE,
    `the session of ${CARD}`,
  );
  assert.equal(card.launch, undefined, "the dialog start leaves no launch");
  assert.ok(
    typeof card.branch === "string" && card.branch !== "",
    "the card has a session branch",
  );
  note(`${CARD} started from the dialog on branch ${card.branch}`);
  return card;
}

/** Commit the work file on the session branch and post the done Stop hook. */
async function finishCard(
  sb: Sandbox,
  sample: SampleRepo,
  card: Card,
): Promise<void> {
  const worktree = path.join(card.workspacePath ?? "", sample.name);
  assert.equal(
    git(worktree, sb.home, ["rev-parse", "--abbrev-ref", "HEAD"]),
    card.branch,
  );
  fs.writeFileSync(path.join(worktree, "feature.txt"), "feature.txt\n");
  git(worktree, sb.home, ["add", "feature.txt"]);
  git(worktree, sb.home, ["commit", "-q", "-m", "feat: profile page"]);
  await sendStopHook(sb, card.tmuxSession ?? "", {
    hook_event_name: "Stop",
    last_assistant_message: DONE_MESSAGE,
  });
  await waitFor(
    async () => (await cardOf(sb, BOARD, CARD))?.column === "agent_done",
    4 * MINUTE,
    `${CARD} in agent_done`,
  );
  note(`${CARD} reached agent_done`);
}

/** Ship card A by its session branch and wait for the flow, the merged PR and the file on the bare origin main. */
async function shipAndWait(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
  card: Card,
): Promise<void> {
  const shipped = await orch(sb, token, "POST", `/groups/${CARD}/ship`, {
    repository: sample.repo,
    branches: [
      {
        name: card.branch,
        title: `feat: profile page ${CARD}`,
        body: SHIP_BODY,
      },
    ],
  });
  assert.equal(shipped.status, 202, JSON.stringify(shipped.body));
  await waitFor(
    async () => {
      const read = await orch<{ flow: ShipFlow }>(
        sb,
        token,
        "GET",
        `/groups/${CARD}/ship`,
      );
      if (read.body.flow?.state === "stopped") {
        throw new Error(`the ship of ${CARD} stopped`);
      }
      return read.body.flow?.state === "done" ? read.body.flow : null;
    },
    10 * MINUTE,
    `the ship of ${CARD} to be done`,
    { pollMs: 1000 },
  );
  const calls = readJsonl(sb.gh.log).map((argv) =>
    Array.isArray(argv) ? argv.map(String) : [],
  );
  const verbs = (verb: string) =>
    calls.filter((c) => c[0] === "pr" && c[1] === verb);
  assert.equal(verbs("create").length, 1);
  assert.equal(verbs("merge").length, 1);
  assert.equal(
    git(sample.bare, sb.home, ["show", "main:feature.txt"]),
    "feature.txt",
    "the bare origin main holds feature.txt",
  );
  note(`${CARD} shipped`);
}

/** Create card B, leave it unstarted, and check that start_ship refuses it with not-group-card and stores no flow. */
async function assertUnstartedRefused(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
): Promise<void> {
  const made = await sb.api<{ id: string }>(
    "POST",
    `/api/cards?board=${BOARD}`,
    { title: "Add the settings page", description: "Never started." },
  );
  assert.equal(made.status, 201);
  assert.equal(made.body.id, UNSTARTED);
  const refused = await orch<{ error: string }>(
    sb,
    token,
    "POST",
    `/groups/${UNSTARTED}/ship`,
    {
      repository: sample.repo,
      branches: [
        {
          name: UNSTARTED,
          title: `feat: settings page ${UNSTARTED}`,
          body: SHIP_BODY,
        },
      ],
    },
  );
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, "not-group-card");
  const card = await cardOf(sb, BOARD, UNSTARTED);
  assert.equal(card?.shipFlow, undefined);
  note(`${UNSTARTED} refused with not-group-card`);
}

/**
 * Run a user-started ticket card from the board start dialog route to the merged ship, then check that an unstarted card is refused.
 *
 * @remarks The only inputs after the orchestrator start are the board start route, the Stop hook of the session, orchestrator routes
 * called with its token, and git and file writes in the session worktree.
 */
async function runScenario(sb: Sandbox): Promise<void> {
  const sample = await setup(sb);
  const token = await startOrchestrator(sb);
  const card = await startFromDialog(sb, sample);
  await finishCard(sb, sample, card);
  await shipAndWait(sb, sample, token, card);
  await assertUnstartedRefused(sb, sample, token);
}

void test(
  "scenario 11: a ticket card that the user started from the board dialog ships through start_ship, and an unstarted card is refused",
  { timeout: 20 * MINUTE },
  async () => {
    const sb = await startSandbox({ name: "s11-user-started-ship" });
    try {
      note(`sandbox port ${sb.port}`);
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

void test("scenario 11 code types no key into any pane", () => {
  const typing = new RegExp(
    [
      ["send", "keys"].join("-?"),
      ["send", "Literal"].join(""),
      ["paste", "buffer"].join("-"),
      ["load", "buffer"].join("-"),
    ].join("|"),
    "i",
  );
  assert.equal(
    typing.test(fs.readFileSync(import.meta.filename, "utf8")),
    false,
  );
});
