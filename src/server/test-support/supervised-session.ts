import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseBoardKey } from "../../shared/board-key.js";
import type { LoopProgress } from "../../shared/types.js";
import { store } from "../store/board.store.js";
import { run } from "../adapters/exec.js";
import { capturePane, TMUX_SERVER_ARGS } from "../adapters/tmux.js";
import { writeFakeClaudeTui } from "./fake-claude-tui.js";
import { materializeLoopFixture } from "./loop-fixtures.js";

export const SBX = parseBoardKey("SBX")!;

export const LOOP_PROGRESS = {
  slug: "sbx-loop",
  roadmapFile: "units.md",
  units: [],
  engine: null,
  completion: "running",
  summary: {
    unitsDone: 0,
    unitsTotal: 2,
    currentUnit: 1,
    currentPhase: { number: 3, name: "x" },
    lastGate: null,
  },
  warnings: [],
  readAt: "2026-10-06T00:00:00.000Z",
} satisfies LoopProgress;

/** Load the isolated store and add the supervised board `SBX`; call once per test file after `isolateEnv`. */
export async function setupSupervisedBoard(): Promise<void> {
  await store.load();
  await store.createBoard({
    key: SBX,
    name: "Sandbox",
    workspaceRoot: "/sbx/sessions",
    repositories: [],
    linearTeamKeys: [],
  });
}

/** Kill the private tmux server of the test process. */
export async function stopSupervisedTmux(): Promise<void> {
  await run("tmux", [...TMUX_SERVER_ARGS, "kill-server"]).catch(
    () => undefined,
  );
}

/** Read a JSON lines file, an empty list when it does not exist. */
export function readJsonl(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function groupCard(title: string) {
  const a = await store.createLocalCard(SBX, `${title}-a`, "");
  const b = await store.createLocalCard(SBX, `${title}-b`, "");
  const made = await store.createGroupCard(SBX, title, [a.id, b.id]);
  assert.ok(made.ok);
  return made.card;
}

/**
 * Start the fake claude in a private tmux session and give it a started card on `SBX`.
 *
 * @remarks
 * Waits until the fake has drawn its pane, since node start-up can pass 500 ms under
 * load. A loop fixture, when named, fills the session root and the loop progress is read from it;
 * otherwise the card gets `LOOP_PROGRESS`. An `orchestrator` id makes the card the hidden card of a
 * `running` orchestrator record of that id, with no loop progress.
 */
export async function startSupervised(opts: {
  tmpRoot: string;
  title: string;
  scenario?: Record<string, unknown>;
  group?: boolean;
  fixture?: string;
  orchestrator?: string;
}) {
  const { title } = opts;
  const root =
    opts.fixture === undefined
      ? fs.mkdtempSync(path.join(opts.tmpRoot, `${title}-`))
      : materializeLoopFixture(opts.fixture);
  const transcript = path.join(root, "transcript.jsonl");
  const keyLog = path.join(root, "keys.jsonl");
  fs.writeFileSync(transcript, "");
  const scenarioFile = path.join(root, "scenario.json");
  let scenario: Record<string, unknown> = {
    transcriptPath: transcript,
    keyLogPath: keyLog,
    statusRows: ["  ⏵⏵ accept edits on"],
    ...opts.scenario,
  };
  fs.writeFileSync(scenarioFile, JSON.stringify(scenario));
  const bin = writeFakeClaudeTui(root);
  const name = `dsp-${title}`;
  await run("tmux", [
    ...TMUX_SERVER_ARGS,
    "new-session",
    "-d",
    "-s",
    name,
    "-x",
    "160",
    "-y",
    "40",
    `FAKE_CLAUDE_SCENARIO='${scenarioFile}' '${bin}'`,
  ]);
  const created =
    opts.orchestrator !== undefined
      ? await store.createOrchestratorCard(SBX, title, opts.orchestrator)
      : opts.group
        ? await groupCard(title)
        : await store.createLocalCard(SBX, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: root,
    tmuxSession: name,
    branch: title,
  });
  const sessionId = store.getCard(created.id)!.activeSessionId!;
  await store.setTranscriptPath(created.id, sessionId, transcript);
  if (opts.orchestrator !== undefined) {
    await store.setBoardOrchestrators(SBX, [
      {
        id: opts.orchestrator,
        name: opts.orchestrator,
        role: "main",
        scope: { groupIds: [], ticketIds: [] },
        policyOverride: {},
        cardId: created.id,
        state: "running",
        createdAt: "2026-10-08T00:00:00.000Z",
      },
    ]);
  } else if (opts.fixture === undefined) {
    await store.setLoopProgress(created.id, LOOP_PROGRESS);
  }
  const pane = () => capturePane(`=${name}:`);
  const deadline = Date.now() + 10_000;
  while ((await pane()).trim() === "" && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  const card = () => store.getCard(created.id)!;
  const session = () => card().sessions!.find((s) => s.id === sessionId)!;
  const keys = () => readJsonl(keyLog);
  return {
    root,
    name,
    transcript,
    card,
    session,
    pane,
    keys,
    userTexts: (file: string = transcript) =>
      readJsonl(file)
        .filter((e) => e.type === "user")
        .map((e) => (e.message as { content: string }).content),
    keysSettled: async (count: number) => {
      const until = Date.now() + 8_000;
      while (keys().length < count && Date.now() < until)
        await new Promise((resolve) => setTimeout(resolve, 50));
      return keys();
    },
    actions: () =>
      store
        .listOrchestrationEvents(SBX, 0, 500)
        .filter(
          (e) => e.cardId === created.id && e.kind === "supervisor_action",
        ),
    setScenario: async (patch: Record<string, unknown>) => {
      scenario = { ...scenario, ...patch };
      fs.writeFileSync(scenarioFile, JSON.stringify(scenario));
      await new Promise((resolve) => setTimeout(resolve, 700));
    },
  };
}
