import path from "node:path";
import {
  ENGINE_REL,
  appendFile,
  armSteps,
  attemptsRel,
  engineText,
  finishSteps,
  passLine,
  print,
  redLine,
  report,
  sleepMs,
  stateRel,
  statusRows,
  waitKeys,
  writeFile,
  type LoopSpec,
  type Step,
} from "./loop-files.js";
import { meterRows, readyRows } from "./status-rows.js";

interface GroupPaths {
  workspace: string;
  home: string;
  replayLog: string;
  keyLog: string;
}

interface LoopSteps {
  onStart: Step[];
  afterClear: Step[];
}

const KICKOFF_SETTLE_MS = 2500;
const HANDOFF_POINTER = "-handoff\\.md and follow it";
const RESUME_PATTERN =
  "The session was restarted\\.|-resume\\.md and follow it";

/** Return the folder where the server looks for the transcripts of a session that runs in `workspace`. */
export function transcriptDirOf(home: string, workspace: string): string {
  return path.join(
    home,
    ".claude",
    "projects",
    workspace.replace(/[^a-zA-Z0-9]/g, "-"),
  );
}

/**
 * Build the loop of the first group: a gate, a handoff at 55 percent, a failed gate that a later pass clears, then the finish.
 *
 * @remarks The 15 s sleep keeps the failed gate on the board long enough for a poll to see it.
 */
export function alphaLoop(spec: LoopSpec): LoopSteps {
  return {
    onStart: [
      sleepMs(KICKOFF_SETTLE_MS),
      ...armSteps(spec),
      print(`${spec.slug} loop armed`),
      appendFile(stateRel(spec), passLine(spec, 1, spec.clock(1))),
      report(1, "pass"),
      statusRows(meterRows(55, "0.40")),
      waitKeys(HANDOFF_POINTER, 180_000),
      writeFile(
        `.roadmap/${spec.slug}/resume.md`,
        `Resume ${spec.slug} at unit 1 phase 2.\n`,
      ),
      writeFile(ENGINE_REL, engineText(spec, "handoff-pending")),
      print(`HANDOFF_READY ${spec.slug}`),
    ],
    afterClear: [
      statusRows(meterRows(8, "0.55")),
      print(`${spec.slug} resumed in a fresh session`),
      appendFile(
        attemptsRel(spec),
        redLine(2, 1, spec.clock(3), "wire check failed"),
      ),
      report(2, "fail", "wire check failed"),
      sleepMs(15_000),
      appendFile(stateRel(spec), passLine(spec, 2, spec.clock(4))),
      report(2, "pass"),
      appendFile(stateRel(spec), passLine(spec, 3, spec.clock(5))),
      report(3, "pass"),
      ...finishSteps(spec),
    ],
  };
}

/**
 * Build the loop of the second group: a gate, then a wait for the resume prompt that follows a usage stop, then the finish.
 */
export function betaLoop(spec: LoopSpec): LoopSteps {
  return {
    onStart: [
      sleepMs(KICKOFF_SETTLE_MS),
      ...armSteps(spec),
      print(`${spec.slug} loop armed`),
      appendFile(stateRel(spec), passLine(spec, 1, spec.clock(1))),
      report(1, "pass"),
      statusRows(meterRows(12, "0.30")),
      waitKeys(RESUME_PATTERN, 600_000),
      print(`${spec.slug} continues after the usage stop`),
      appendFile(stateRel(spec), passLine(spec, 2, spec.clock(2))),
      report(2, "pass"),
      appendFile(stateRel(spec), passLine(spec, 3, spec.clock(3))),
      report(3, "pass"),
      ...finishSteps(spec),
    ],
    afterClear: [],
  };
}

/** Build the whole scenario file of one group session, with the fake transcript pointed where the server reads it. */
export function groupScenario(
  paths: GroupPaths,
  loop: LoopSteps,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const dir = transcriptDirOf(paths.home, paths.workspace);
  return {
    statusRows: readyRows(),
    reply: "ok",
    replayLogPath: paths.replayLog,
    keyLogPath: paths.keyLog,
    transcriptDir: dir,
    transcriptPath: path.join(dir, "original-session.jsonl"),
    engineFile: path.join(paths.workspace, ENGINE_REL),
    loop,
    ...extra,
  };
}
