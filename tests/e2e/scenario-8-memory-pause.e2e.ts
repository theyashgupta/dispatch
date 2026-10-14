import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ORCHESTRATOR_TOKEN_HEADER } from "../../src/shared/orchestrator-limits.js";
import type { Card } from "../../src/shared/types.js";
import { makeSampleRepo, type SampleRepo } from "./fixtures/scenario-1/repo.js";
import { readyRows } from "./fixtures/scenario-1/status-rows.js";
import { cardOf, writeRunLog } from "./harness/board-reads.js";
import {
  EVIDENCE_DIR,
  MINUTE,
  SANDBOX_ROOT,
  makeNote,
  sleep,
  startSandbox,
  waitFor,
  type OrchestrationEventRow,
  type Sandbox,
} from "./harness/sandbox.js";

const NAME = "scenario-8";
const BOARD = "MEM";
const ORCHESTRATOR = "main";
const RUN_LOG = path.join(EVIDENCE_DIR, "scenario-8-run-log.txt");
const SAMPLE_FILE = path.join(SANDBOX_ROOT, `${NAME}-memory-sample.json`);
const CEILING_MB = 8192;
const RESUME_BELOW_MB = CEILING_MB - 1024;
const READING_WAIT_MS = 40_000;
const TMUX_MISSING =
  spawnSync("tmux", ["-V"], { stdio: "ignore" }).status !== 0
    ? "tmux is not installed"
    : false;

const note = makeNote("scenario-8");

/**
 * Write the sample file the server reads every 15 s, through a rename so a read never sees half a file.
 *
 * @remarks Only swap moves between calls. The free memory stays far above the floor, so no start is refused.
 */
function writeSwap(swapUsedMb: number): void {
  const temp = `${SAMPLE_FILE}.tmp`;
  fs.writeFileSync(
    temp,
    JSON.stringify({
      freeMb: 4096,
      compressorMb: 500,
      swapUsedMb,
      swapTotalMb: 12288,
      load1: 2,
    }),
  );
  fs.renameSync(temp, SAMPLE_FILE);
  note(`swap set to ${swapUsedMb} MB`);
}

/** Read the sample the server holds, or null before its first reading. */
async function serverSample(
  sb: Sandbox,
): Promise<{ at: string; swapUsedMb: number } | null> {
  const res = await sb.api<{
    sample?: { at: string; swapUsedMb: number };
  }>("GET", "/api/system/memory");
  return res.body.sample ?? null;
}

/** Wait until the server holds a reading of `swapUsedMb`, then until `count` newer readings have followed it. */
async function waitForReadings(
  sb: Sandbox,
  swapUsedMb: number,
  count: number,
): Promise<void> {
  let last = (
    await waitFor(
      async () => {
        const sample = await serverSample(sb);
        return sample?.swapUsedMb === swapUsedMb ? sample : null;
      },
      READING_WAIT_MS,
      `a reading of ${swapUsedMb} MB`,
    )
  ).at;
  for (let n = 1; n <= count; n++) {
    const seen = last;
    last = (
      await waitFor(
        async () => {
          const sample = await serverSample(sb);
          return sample !== null && sample.at !== seen ? sample : null;
        },
        READING_WAIT_MS,
        `reading ${n} after the ${swapUsedMb} MB reading`,
      )
    ).at;
  }
}

/** Return the `ps` state letters of `pid`, or an empty string when the process is gone. */
function stateOf(pid: number): string {
  return spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
    encoding: "utf8",
  }).stdout.trim();
}

/** Return the pids of a pause mark without the first one, which is the shell of the pane. */
function childPids(mark: NonNullable<Card["paused"]>): number[] {
  return mark.pids.slice(1);
}

/** Return the pause or resume rows of one card, in event order. */
function governorRows(
  events: OrchestrationEventRow[],
  cardId: string,
  action: "pause" | "resume",
): OrchestrationEventRow[] {
  return events.filter(
    (e) =>
      e.kind === "supervisor_action" &&
      e.cardId === cardId &&
      e.data.action === action,
  );
}

/** Read the pause mark of one card, or undefined when it is not paused. */
async function pausedOf(
  sb: Sandbox,
  id: string,
): Promise<Card["paused"] | undefined> {
  return (await cardOf(sb, BOARD, id))?.paused ?? undefined;
}

/** Create the board with its three tickets, the cap and the memory policy, and the orchestrator record. */
async function setup(
  sb: Sandbox,
  sample: SampleRepo,
): Promise<[string, string, string]> {
  fs.writeFileSync(
    path.join(sb.scenarios, "default.json"),
    JSON.stringify({ statusRows: readyRows(), reply: "ok" }),
  );
  const sessions = path.join(sb.workspaces, "mem-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Memory board",
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
    supervisor: "off",
    groupPlaybook: null,
    memoryFloorMb: 1024,
    swapCeilingMb: CEILING_MB,
  });
  assert.equal(policy.status, 200);
  const added = await sb.api("POST", `/api/boards/${BOARD}/orchestrators`, {
    id: ORCHESTRATOR,
    name: "Main",
    role: "main",
  });
  assert.equal(added.status, 201);
  const ids: string[] = [];
  for (const n of [1, 2, 3]) {
    const made = await sb.api<{ id: string }>(
      "POST",
      `/api/cards?board=${BOARD}`,
      { title: `Ticket ${n}`, description: `Do the work of ticket ${n}.` },
    );
    assert.equal(made.status, 201);
    ids.push(made.body.id);
  }
  assert.deepEqual(ids, ["MEM-1", "MEM-2", "MEM-3"]);
  return ids as [string, string, string];
}

/** Start one ticket through the `start_card` route with the orchestrator token and wait for its live session. */
async function startLoop(
  sb: Sandbox,
  token: string,
  sample: SampleRepo,
  id: string,
): Promise<void> {
  const res = await fetch(`${sb.url}/api/orchestrator/cards/${id}/start`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [ORCHESTRATOR_TOKEN_HEADER]: token,
    },
    body: JSON.stringify({
      playbook: "Write code directly",
      repos: [{ path: sample.repo, base: "main" }],
    }),
  });
  assert.equal(res.status, 202, await res.text());
  await waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, id);
      return card?.tmuxSession !== undefined &&
        card.activeSessionId !== undefined
        ? card
        : null;
    },
    MINUTE,
    `${id} with a live tmux session and an active session id`,
  );
  note(`${id} has a live session`);
}

/**
 * Drive swap through the sample file and check that the governor pauses the newest loop, holds, and resumes it.
 *
 * @remarks The three loops start 2 s apart so `createdAt` orders them. The only inputs after the start are HTTP
 * calls and writes to the sample file, and no key is typed into a pane. `held.userPaused` names the card that
 * the caller must unpause, whatever the outcome.
 */
async function runScenario(
  sb: Sandbox,
  held: { userPaused?: string },
): Promise<void> {
  const sample = makeSampleRepo(sb.root, sb.home);
  const [a, b, c] = await setup(sb, sample);
  const minted = await sb.api<{ token: string }>(
    "POST",
    `/api/boards/${BOARD}/orchestrators/${ORCHESTRATOR}/token`,
  );
  assert.equal(minted.status, 201);

  for (const id of [a, b, c]) {
    await startLoop(sb, minted.body.token, sample, id);
    await sleep(2000);
  }
  assert.equal((await serverSample(sb))?.swapUsedMb, 1000);
  for (const id of [a, b, c]) assert.equal(await pausedOf(sb, id), undefined);

  writeSwap(9000);
  const mark = await waitFor(
    async () => {
      const paused = await pausedOf(sb, c);
      const logged = governorRows(
        await sb.orchestrationEvents(BOARD),
        c,
        "pause",
      );
      return paused?.by === "memory" && logged.length > 0 ? paused : null;
    },
    READING_WAIT_MS,
    `${c} paused by memory and its pause event`,
  );
  note(`${c} paused, pids ${mark.pids.join(" ")}`);
  assert.equal(await pausedOf(sb, a), undefined);
  assert.equal(await pausedOf(sb, b), undefined);
  const pauses = governorRows(await sb.orchestrationEvents(BOARD), c, "pause");
  assert.equal(pauses.length, 1);
  assert.equal(
    pauses[0]?.data.reason,
    `swap used 9000 MB is above the ${CEILING_MB} MB ceiling`,
  );
  assert.equal(pauses[0]?.data.by, "memory");
  assert.ok(
    childPids(mark).some((pid) => stateOf(pid).startsWith("T")),
    `no child pid of ${c} is stopped: ${childPids(mark)
      .map((p) => `${p}=${stateOf(p)}`)
      .join(" ")}`,
  );

  writeSwap(9100);
  await waitForReadings(sb, 9100, 2);
  const grown = await sb.orchestrationEvents(BOARD);
  assert.equal(governorRows(grown, c, "pause").length, 1);
  for (const id of [a, b]) {
    assert.equal(governorRows(grown, id, "pause").length, 0);
    assert.equal(await pausedOf(sb, id), undefined);
  }
  note("growth under 256 MB paused nothing more");

  const userPause = await sb.api("POST", `/api/cards/${b}/pause`);
  held.userPaused = b;
  assert.equal(userPause.status, 200);
  assert.equal((await pausedOf(sb, b))?.by, "user");

  writeSwap(6000);
  await waitFor(
    async () =>
      (await pausedOf(sb, c)) === undefined &&
      governorRows(await sb.orchestrationEvents(BOARD), c, "resume").length > 0
        ? true
        : null,
    50_000,
    `${c} resumed and its resume event`,
  );
  const resumes = governorRows(
    await sb.orchestrationEvents(BOARD),
    c,
    "resume",
  );
  assert.equal(resumes.length, 1);
  assert.equal(
    resumes[0]?.data.reason,
    `swap used 6000 MB is below ${RESUME_BELOW_MB} MB`,
  );
  for (const pid of childPids(mark)) {
    assert.equal(
      stateOf(pid).startsWith("T"),
      false,
      `pid ${pid} of ${c} is still stopped`,
    );
  }
  note(`${c} resumed`);

  await waitForReadings(sb, 6000, 3);
  assert.equal((await pausedOf(sb, b))?.by, "user");
  assert.equal(
    governorRows(await sb.orchestrationEvents(BOARD), b, "resume").length,
    0,
  );
  assert.equal(await pausedOf(sb, a), undefined);
  note("the user pause of the second loop survived the low readings");
}

void test(
  "scenario 8: swap pressure pauses the newest loop, growth under 256 MB holds, and low swap resumes it",
  { timeout: 6 * MINUTE, skip: TMUX_MISSING },
  async () => {
    fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
    writeSwap(1000);
    const sb = await startSandbox({
      name: NAME,
      memorySampleFile: SAMPLE_FILE,
    });
    const held: { userPaused?: string } = {};
    try {
      await runScenario(sb, held);
    } finally {
      try {
        if (held.userPaused !== undefined) {
          await sb.api("POST", `/api/cards/${held.userPaused}/unpause`);
        }
        await writeRunLog(sb, BOARD, RUN_LOG);
      } catch (err) {
        note(
          `cleanup step failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      await sb.stop();
    }
  },
);
