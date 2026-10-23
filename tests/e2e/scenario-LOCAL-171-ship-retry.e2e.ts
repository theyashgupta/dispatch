import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Card, ShipFlow } from "../../src/shared/types.js";
import { setGhScenario } from "../../src/server/test-support/fake-gh.js";
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

const BOARD = "RTY";
const RETRY_CARD = "RTY-1";
const SEEDED_CARD = "RTY-2";
const ORCHESTRATOR_CARD = "RTY-3";
const RUN_LOG = path.join(EVIDENCE_DIR, "local-171-ship-retry-run-log.txt");
const DONE_MESSAGE = "DISPATCH_STATUS: DONE - built";
const SHIP_BODY =
  "What\nThe work of the card.\nWhy\nThe card is done.\nHow\nShipped by the test.";
const FAILURE_LINE = "not ok 1 - the real failure";

const note = makeNote("local-171-ship-retry");

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
}

interface CheckScript {
  setMode: (mode: "pass" | "fail") => void;
  runs: () => number;
}

/**
 * Post the Stop hook event that a real session sends when its last message holds a status marker.
 *
 * @remarks The token is read from the tmux session environment, the same place the hook script of a real session reads it.
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

/**
 * Write the check script into the sandbox folder, outside every repository, and return its path with its controls.
 *
 * @remarks The script reads a mode file next to it, so the worktree stays clean between the three ships.
 */
function writeCheckScript(sb: Sandbox): CheckScript & { file: string } {
  const folder = path.join(sb.root, "check");
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, "check.sh");
  const modeFile = path.join(folder, "mode");
  const countFile = path.join(folder, "count.txt");
  fs.writeFileSync(
    file,
    [
      "#!/bin/sh",
      'dir=$(dirname "$0")',
      'mode=$(cat "$dir/mode")',
      'if [ "$mode" = "fail" ]; then',
      "  echo '[boundaries][warning]: Detected legacy selector syntax' >&2",
      "  echo '> @acme/app@1.0.0 test'",
      `  echo '${FAILURE_LINE}'`,
      "  exit 3",
      "fi",
      'echo ran >> "$dir/count.txt"',
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  fs.writeFileSync(modeFile, "pass");
  return {
    file,
    setMode: (mode) => fs.writeFileSync(modeFile, mode),
    runs: () =>
      fs.existsSync(countFile)
        ? fs
            .readFileSync(countFile, "utf8")
            .split("\n")
            .filter((l) => l !== "").length
        : 0,
  };
}

async function setup(
  sb: Sandbox,
  script: string,
): Promise<{ sample: SampleRepo; transcript: string }> {
  const sample = makeSampleRepo(sb.root, sb.home);
  const sessions = path.join(sb.workspaces, "rty-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Ship retry board",
    workspaceRoot: sessions,
    repositories: [
      { path: sample.repo, baseBranch: "main", checkCommand: script },
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
  for (const [i, title] of [
    "Add the retry page",
    "Add the seeded page",
  ].entries()) {
    const made = await sb.api<{ id: string }>(
      "POST",
      `/api/cards?board=${BOARD}`,
      { title, description: "One feature of one page." },
    );
    assert.equal(made.status, 201);
    assert.equal(made.body.id, [RETRY_CARD, SEEDED_CARD][i]);
  }
  const added = await sb.api("POST", `/api/boards/${BOARD}/orchestrators`, {
    id: "main",
    name: "Main",
    role: "main",
  });
  assert.equal(added.status, 201);

  const transcript = path.join(sb.logs, "orchestrator.jsonl");
  fs.writeFileSync(transcript, "");
  for (const id of [RETRY_CARD, SEEDED_CARD]) {
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
  return { sample, transcript };
}

/** Start the main orchestrator, send its SessionStart hook and return the token minted after the start. */
async function startOrchestrator(
  sb: Sandbox,
  transcript: string,
): Promise<string> {
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
  const minted = await sb.api<{ token: string }>(
    "POST",
    `/api/boards/${BOARD}/orchestrators/main/token`,
  );
  assert.equal(minted.status, 201);
  note("orchestrator started");
  return minted.body.token;
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

async function startAndFinish(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
  id: string,
  file: string,
): Promise<Card> {
  const started = await orch(sb, token, "POST", `/cards/${id}/start`, {
    playbook: "Write code directly",
    direction: "Build it.",
  });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  const card = await awaitSession(sb, id);
  assert.notEqual(card.launch, undefined, `${id} has a launch`);
  const worktree = path.join(card.workspacePath ?? "", sample.name);
  assert.equal(
    git(worktree, sb.home, ["rev-parse", "--abbrev-ref", "HEAD"]),
    card.identifier,
  );
  fs.writeFileSync(path.join(worktree, file), `${file}\n`);
  git(worktree, sb.home, ["add", file]);
  git(worktree, sb.home, ["commit", "-q", "-m", `feat: ${file}`]);
  await postHook(sb, card.tmuxSession ?? "", {
    hook_event_name: "Stop",
    last_assistant_message: DONE_MESSAGE,
  });
  await waitFor(
    async () => (await cardOf(sb, BOARD, id))?.column === "agent_done",
    4 * MINUTE,
    `${id} in agent_done`,
  );
  note(`${id} reached agent_done`);
  return card;
}

async function shipUntilEnd(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
  card: Card,
): Promise<ShipFlow> {
  const shipped = await orch(sb, token, "POST", `/groups/${card.id}/ship`, {
    repository: sample.repo,
    branches: [
      {
        name: card.identifier,
        title: `feat: ${card.identifier}`,
        body: SHIP_BODY,
      },
    ],
  });
  assert.equal(shipped.status, 202, JSON.stringify(shipped.body));
  return waitFor(
    async () => {
      const read = await orch<{ flow: ShipFlow }>(
        sb,
        token,
        "GET",
        `/groups/${card.id}/ship`,
      );
      return read.body.flow?.state === "running" ? null : read.body.flow;
    },
    10 * MINUTE,
    `the ship of ${card.id} to stop or finish`,
    { pollMs: 1000 },
  );
}

const ghCalls = (sb: Sandbox, verb: string): string[][] =>
  readJsonl(sb.gh.log)
    .map((argv) => (Array.isArray(argv) ? argv.map(String) : []))
    .filter((c) => c[0] === "pr" && c[1] === verb);

const groupStates = async (
  sb: Sandbox,
  id: string,
  state: string,
): Promise<{ reason: unknown }[]> =>
  (await sb.orchestrationEvents(BOARD))
    .filter(
      (e) =>
        e.kind === "group_state" && e.cardId === id && e.data.state === state,
    )
    .map((e) => ({ reason: e.data.reason }));

async function assertFailedCheckReason(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
  card: Card,
  script: CheckScript,
): Promise<void> {
  script.setMode("fail");
  const flow = await shipUntilEnd(sb, sample, token, card);
  assert.equal(flow.state, "stopped");
  assert.equal(flow.failedStep, "checking");
  const reason = flow.reason ?? "";
  assert.ok(reason.includes("step test"), reason);
  assert.ok(reason.includes("exit code 3"), reason);
  assert.ok(reason.includes(FAILURE_LINE), reason);
  const open = await sb.api<{ items: { kind: string; question: string }[] }>(
    "GET",
    `/api/decisions?board=${BOARD}&state=open`,
  );
  const item = open.body.items.find((i) => i.kind === "ship_failure");
  assert.ok(item?.question.includes(reason), "the decision holds the reason");
  const stopped = await groupStates(sb, card.id, "ship_stopped");
  assert.equal(stopped.at(-1)?.reason, reason);
  assert.equal(script.runs(), 0);
  note("ship stopped at checking with the failing step and the output tail");
}

async function assertStopsAtChecks(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
  card: Card,
  script: CheckScript,
): Promise<number> {
  script.setMode("pass");
  setGhScenario(sb.gh.scenario, { checks: "fail" });
  const flow = await shipUntilEnd(sb, sample, token, card);
  assert.equal(flow.state, "stopped");
  assert.equal(flow.failedStep, "waiting_checks");
  const pr = flow.branches[0]?.pr;
  assert.equal(typeof pr, "number");
  assert.equal(flow.branches[0]?.checkSkipped, false);
  assert.equal(script.runs(), 1);
  assert.equal(ghCalls(sb, "create").length, 1);
  note(`ship stopped at waiting_checks with PR ${String(pr)}`);
  return pr as number;
}

/**
 * Ship a third time on the same merged tip with passing PR checks, and assert the check command did not run again and no second PR opened.
 *
 * @remarks The open PR of the fake gh gets the pushed head as its `headRefOid`, and its list hides the PR whenever that head differs from the origin head.
 */
async function assertSkipAndAdopt(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
  card: Card,
  script: CheckScript,
  pr: number,
): Promise<void> {
  const head = git(sample.bare, sb.home, [
    "rev-parse",
    `refs/heads/${card.identifier}`,
  ]);
  const stateFile = path.join(path.dirname(sb.gh.log), "gh-state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as {
    prs: Record<string, { headRefOid?: string }>;
  };
  const stored = state.prs[String(pr)];
  assert.ok(stored, `the fake gh holds PR ${pr}`);
  stored.headRefOid = head;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  setGhScenario(sb.gh.scenario, { checks: "pass", hideOpenPrs: "afterPush" });

  const flow = await shipUntilEnd(sb, sample, token, card);
  assert.equal(flow.state, "done", flow.reason ?? "");
  const branch = flow.branches[0];
  assert.equal(branch?.pr, pr);
  assert.equal(branch?.checkSkipped, true);
  assert.ok(branch?.passed != null && branch.passed === branch.checked);
  assert.equal(script.runs(), 1, "the check command ran no second time");
  assert.equal(ghCalls(sb, "create").length, 1);
  assert.equal(ghCalls(sb, "merge").length, 1);
  const skipped = await groupStates(sb, card.id, "ship_check_skipped");
  assert.equal(skipped.length, 1);
  assert.equal(
    git(sample.bare, sb.home, ["show", "main:retry.txt"]),
    "retry.txt",
    "the bare origin main holds retry.txt",
  );
  await waitFor(
    async () => (await cardOf(sb, BOARD, card.id))?.column === "done",
    MINUTE,
    `${card.id} in Done`,
  );
  note("third ship skipped the check command, adopted the PR and merged");
}

async function assertSeededPrAdopted(
  sb: Sandbox,
  sample: SampleRepo,
  token: string,
  card: Card,
  retryBranch: string,
): Promise<void> {
  const stateFile = path.join(path.dirname(sb.gh.log), "gh-state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as {
    next: number;
    prs: Record<string, unknown>;
  };
  const worktree = path.join(card.workspacePath ?? "", sample.name);
  const older = git(worktree, sb.home, ["rev-parse", "HEAD~1"]);
  git(worktree, sb.home, [
    "push",
    "-q",
    "origin",
    `${older}:refs/heads/${card.identifier}`,
  ]);
  const seeded = state.next;
  state.prs[String(seeded)] = {
    head: card.identifier,
    base: "main",
    title: `feat: ${card.identifier}`,
    state: "OPEN",
    polls: 0,
    mergePolls: 0,
    headRefOid: older,
  };
  state.next += 1;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  setGhScenario(sb.gh.scenario, { checks: "pass", hideOpenPrs: "afterPush" });

  const flow = await shipUntilEnd(sb, sample, token, card);
  assert.equal(flow.state, "done", flow.reason ?? "");
  assert.equal(flow.branches[0]?.pr, seeded);
  const created = ghCalls(sb, "create").map((c) => c[c.indexOf("--head") + 1]);
  assert.equal(created.includes(card.identifier), false);
  assert.deepEqual(created, [retryBranch]);
  assert.equal(ghCalls(sb, "merge").length, 2);
  assert.equal(
    git(sample.bare, sb.home, ["show", "main:seeded.txt"]),
    "seeded.txt",
    "the bare origin main holds seeded.txt",
  );
  note(`seeded PR ${seeded} adopted with no pr create call`);
}

/**
 * Run one card through a failed check, a failed PR check and a retry on the same tip, then a second card whose open PR exists before its first ship.
 *
 * @remarks The only inputs after the orchestrator start are orchestrator routes called with its token, the Stop hooks of the sessions, git and file writes in the session worktrees, and the fake gh scenario and state files.
 */
async function runScenario(sb: Sandbox): Promise<void> {
  const script = writeCheckScript(sb);
  const { sample, transcript } = await setup(sb, script.file);
  const token = await startOrchestrator(sb, transcript);
  const retry = await startAndFinish(
    sb,
    sample,
    token,
    RETRY_CARD,
    "retry.txt",
  );
  const seeded = await startAndFinish(
    sb,
    sample,
    token,
    SEEDED_CARD,
    "seeded.txt",
  );
  await assertFailedCheckReason(sb, sample, token, retry, script);
  const pr = await assertStopsAtChecks(sb, sample, token, retry, script);
  await assertSkipAndAdopt(sb, sample, token, retry, script, pr);
  await assertSeededPrAdopted(sb, sample, token, seeded, retry.identifier);
}

void test(
  "scenario-LOCAL-171-ship-retry: a ship retry reports the failing step, skips a passed check and adopts the open PR",
  { timeout: 20 * MINUTE },
  async () => {
    const sb = await startSandbox({ name: "local-171-ship-retry" });
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

void test("scenario-LOCAL-171-ship-retry code types no key into any pane", () => {
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
