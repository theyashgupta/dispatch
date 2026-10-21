import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { ActivityEvent } from "../../src/shared/types.js";
import { makeSampleRepo } from "./fixtures/scenario-1/repo.js";
import { meterRows, readyRows } from "./fixtures/scenario-1/status-rows.js";
import { cardOf, readJsonl } from "./harness/board-reads.js";
import {
  MINUTE,
  SANDBOX_ROOT,
  makeNote,
  startSandbox,
  waitFor,
  type OrchestrationEventRow,
  type Sandbox,
} from "./harness/sandbox.js";

const NAME = "scenario-15";
const BOARD = "FRZ";
const CARD = "FRZ-1";
const CONVERSATION = "conv-frozen";
const RELAUNCH_MS = 20_000;
const ARGV_FILE = path.join(SANDBOX_ROOT, NAME, "argv.jsonl");
const SAMPLE_FILE = path.join(SANDBOX_ROOT, `${NAME}-memory-sample.json`);
const RESUME_TEXT =
  "The session was restarted. Continue from where you stopped.";

const note = makeNote("scenario-15");

const argvLines = (): string[] =>
  fs.existsSync(ARGV_FILE)
    ? fs
        .readFileSync(ARGV_FILE, "utf8")
        .split("\n")
        .filter((l) => l !== "")
    : [];

/** Write a memory sample with low swap, so the memory governor never refuses the resume. */
function writeLowSwap(): void {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  fs.writeFileSync(
    SAMPLE_FILE,
    JSON.stringify({
      freeMb: 4096,
      compressorMb: 500,
      swapUsedMb: 0,
      swapTotalMb: 12288,
      load1: 2,
    }),
  );
}

/** Answer the board policy body with the supervisor on. */
const policy = () => ({
  roadmapApproval: "all",
  concurrencyCap: 2,
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

/** Post one hook event for a session with the hook token of its tmux environment. */
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

const supervisorActions = async (
  sb: Sandbox,
  action: string,
): Promise<OrchestrationEventRow[]> =>
  (await sb.orchestrationEvents(BOARD)).filter(
    (e) => e.kind === "supervisor_action" && e.data.action === action,
  );

const relaunchCount = async (sb: Sandbox): Promise<number> => {
  const res = await sb.api<{ events: ActivityEvent[] }>(
    "GET",
    `/api/events?board=${BOARD}&cardId=${CARD}&limit=1000`,
  );
  return res.body.events.filter((e) => e.type === "session_relaunch").length;
};

/**
 * Freeze a session after an idle compaction and check the single relaunch with resume.
 *
 * @remarks The freeze file holds every Enter of the fake, so the typed line stays in the prompt box until a signal ends the fake.
 */
async function runScenario(sb: Sandbox): Promise<void> {
  const defaultFile = path.join(sb.scenarios, "default.json");
  const transcript = path.join(
    sb.root,
    "projects",
    "frz",
    `${CONVERSATION}.jsonl`,
  );
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  const freezeFile = path.join(sb.root, "frz.freeze");
  fs.writeFileSync(transcript, "");
  fs.writeFileSync(
    defaultFile,
    JSON.stringify({
      statusRows: readyRows(),
      reply: "ok",
      transcriptPath: transcript,
    }),
  );
  const sample = makeSampleRepo(sb.root, sb.home);
  const sessions = path.join(sb.workspaces, "frz-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Frozen relaunch board",
    workspaceRoot: sessions,
    repositories: [
      { path: sample.repo, baseBranch: "main", checkCommand: "true" },
    ],
  });
  assert.equal(board.status, 201);
  const on = await sb.api("PUT", `/api/boards/${BOARD}/policy`, policy());
  assert.equal(on.status, 200);
  const made = await sb.api<{ id: string }>(
    "POST",
    `/api/cards?board=${BOARD}`,
    {
      title: "Freeze me",
      description: "A session that freezes after compaction.",
    },
  );
  assert.equal(made.status, 201);
  assert.equal(made.body.id, CARD);
  const start = await sb.api("POST", `/api/cards/${CARD}/start`, {
    folder: sb.workspaces,
    repos: [{ path: sample.repo, base: "main" }],
  });
  assert.equal(start.status, 202);
  const live = await waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, CARD);
      return card?.tmuxSession !== undefined && card.workspacePath
        ? card
        : null;
    },
    MINUTE,
    "the card with a live tmux session",
  );
  const session = live.tmuxSession ?? "";
  note(`session started: ${session}`);

  await postHook(sb, session, {
    hook_event_name: "UserPromptSubmit",
    session_id: CONVERSATION,
    transcript_path: transcript,
    prompt: "hi",
  });
  await waitFor(
    async () =>
      (await cardOf(sb, BOARD, CARD))?.claudeSessionId === CONVERSATION,
    MINUTE,
    `claudeSessionId ${CONVERSATION} on the card`,
  );
  note(`hook routed: claudeSessionId is ${CONVERSATION}`);

  const before = argvLines().length;
  fs.writeFileSync(freezeFile, "");
  fs.writeFileSync(
    defaultFile,
    JSON.stringify({
      statusRows: [...meterRows(0, "1.00"), "  ⏵⏵ bypass permissions on"],
      transcript: [
        "⏺ The phase gate passed. I wait for the next wake.",
        "✻ Compacted while idle",
      ],
      reply: "ok",
      transcriptPath: transcript,
      freezeFile,
    }),
  );
  note("freeze file written, pane shows the idle compaction");

  const sent = await sb.api<{ result: string }>(
    "POST",
    `/api/sessions/${CARD}/input`,
    { text: "Delegate: are you there?" },
  );
  assert.equal(sent.status, 200);
  assert.equal(sent.body.result, "unconfirmed");
  const held = (await supervisorActions(sb, "send")).filter(
    (e) => e.cardId === CARD && e.data.reason === "held in prompt box",
  );
  assert.ok(held.length >= 1, "a send row with reason held in prompt box");
  note("send_input answered unconfirmed: held in prompt box");

  const frozen = await waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, CARD);
      return card?.state === "frozen" ? card : null;
    },
    3 * MINUTE,
    "the card in state frozen",
  );
  const stateSince = frozen.stateSince ?? "";
  assert.notEqual(stateSince, "");
  note(`card is frozen since ${stateSince}`);
  assert.equal(argvLines().length, before, "no relaunch yet");
  assert.equal((await supervisorActions(sb, "relaunch_frozen")).length, 0);

  const relaunch = await waitFor(
    async () => {
      const rows = await supervisorActions(sb, "relaunch_frozen");
      return rows.find((e) => e.data.result === "stopped") ?? null;
    },
    3 * MINUTE,
    "the relaunch_frozen row",
  );
  const waited = Date.parse(relaunch.ts) - Date.parse(stateSince);
  note(`relaunch_frozen ${Math.round(waited / 1000)} s after stateSince`);
  assert.ok(
    waited >= RELAUNCH_MS,
    `relaunch came ${waited} ms after stateSince, expected at least ${RELAUNCH_MS}`,
  );
  assert.equal(fs.existsSync(freezeFile), false, "the signal ended the fake");
  const newest = await waitFor(
    () => (argvLines().length > before ? (argvLines().at(-1) ?? "") : null),
    MINUTE,
    "the relaunch launch line",
  );
  const args = JSON.parse(newest) as string[];
  assert.equal(args[args.indexOf("--resume") + 1], CONVERSATION);
  note(`relaunched with ${newest}`);

  await waitFor(
    async () =>
      (await supervisorActions(sb, "resume")).find(
        (e) => e.data.result === "confirmed",
      ) ?? null,
    2 * MINUTE,
    "the confirmed resume row",
  );
  const prompt = readJsonl(transcript).find(
    (entry) =>
      entry.type === "user" &&
      (entry.message as { content?: string }).content === RESUME_TEXT,
  );
  assert.ok(prompt, "the transcript holds the loop prompt");
  note("loop prompt typed after the relaunch");

  assert.equal(await relaunchCount(sb), 1);
  await sb.pause(60_000);
  assert.equal((await supervisorActions(sb, "relaunch_frozen")).length, 1);
  assert.equal(await relaunchCount(sb), 1);
  note("still one relaunch after 60 s");
}

void test(
  "scenario 15: a session frozen after an idle compaction is relaunched once with resume",
  { timeout: 10 * MINUTE },
  async () => {
    process.env.FAKE_CLAUDE_ARGV_FILE = ARGV_FILE;
    writeLowSwap();
    const sb = await startSandbox({
      name: NAME,
      memorySampleFile: SAMPLE_FILE,
      env: { DISPATCH_FROZEN_RELAUNCH_MS: String(RELAUNCH_MS) },
    });
    try {
      await runScenario(sb);
    } finally {
      await sb.stop();
      delete process.env.FAKE_CLAUDE_ARGV_FILE;
    }
  },
);
