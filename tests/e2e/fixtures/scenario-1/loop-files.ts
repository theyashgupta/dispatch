export interface LoopSpec {
  slug: string;
  title: string;
  ticket: string;
  branch: string;
  repoDir: string;
  phases: string[];
  clock: (step: number) => string;
}

export type Step = Record<string, unknown>;

export const ENGINE_REL = ".claude/ralph-loop.local.md";

/** The path of a loop file below the repository folder of the workspace. */
function planPath(spec: LoopSpec, rest: string): string {
  return `${spec.repoDir}/.planning/${rest}`;
}

const prdRel = (spec: LoopSpec): string =>
  planPath(spec, `prds/${spec.slug}-unit-1.md`);

export const stateRel = (spec: LoopSpec): string =>
  planPath(spec, `${spec.slug}-unit-1/state.md`);

export const attemptsRel = (spec: LoopSpec): string =>
  planPath(spec, `${spec.slug}-unit-1/attempts.md`);

export const progressRel = (spec: LoopSpec): string =>
  `.roadmap/${spec.slug}/progress.md`;

/** The roadmap file the loop root holds, with the one unit in the given status. */
function roadmapText(spec: LoopSpec, status: string): string {
  return [
    `# ${spec.title} roadmap`,
    "",
    `Slug: \`${spec.slug}\`.`,
    "",
    `### Unit 1: ${spec.title} unit`,
    `- **Status:** ${status}`,
    `- **PRD:** \`${prdRel(spec)}\``,
    "",
  ].join("\n");
}

/** The progress ledger; the branch cell names the ticket the board shows for the unit. */
function progressText(spec: LoopSpec, status: string): string {
  return [
    `Roadmap: ROADMAP.md | slug: ${spec.slug} | repo: ${spec.repoDir}/`,
    "",
    "## Units",
    "| Unit | Status | Branch | PRD | Reopen rounds |",
    "| - | - | - | - | - |",
    `| 1 | ${status} | ${spec.branch} (from main) | ${prdRel(spec)} | 0 |`,
    "",
  ].join("\n");
}

/** The PRD with one `### Phase N:` heading and one retry budget line per phase. */
function prdText(spec: LoopSpec): string {
  const phases = spec.phases.flatMap((name, i) => [
    `### Phase ${i + 1}: ${name}`,
    "- **Retry budget:** 2",
    "",
  ]);
  return [`# ${spec.title} unit PRD`, "", ...phases].join("\n");
}

/** The ralph loop engine file with the given session id line. */
export function engineText(spec: LoopSpec, sessionId: string): string {
  return [
    "---",
    "active: true",
    "iteration: 1",
    `session_id: ${sessionId}`,
    "max_iterations: 50",
    `completion_promise: "ROADMAP COMPLETE ${spec.slug}"`,
    `started_at: "${spec.clock(0)}"`,
    "---",
    "",
    `Execute the roadmap at ROADMAP.md, slug ${spec.slug}.`,
    "",
  ].join("\n");
}

/** One `gate=pass` line of the state file; the board reads the gate time from this timestamp. */
export function passLine(spec: LoopSpec, phase: number, at: string): string {
  const name = spec.phases[phase - 1]?.toLowerCase().replace(/\s+/g, "-");
  return `phase ${phase} ${name} GREEN ${at} gate=pass\n`;
}

/** One RED attempt line of the attempts file. */
export function redLine(
  phase: number,
  attempt: number,
  at: string,
  note: string,
): string {
  return `phase ${phase} RED attempt ${attempt} ${at} (${note})\n`;
}

export const writeFile = (file: string, content: string): Step => ({
  writeFile: file,
  content,
});

export const appendFile = (file: string, content: string): Step => ({
  appendFile: file,
  content,
});

export const report = (
  phase: number,
  result: "pass" | "fail",
  note?: string,
): Step => ({
  report: {
    kind: "phase",
    unit: 1,
    phase,
    result,
    ...(note === undefined ? {} : { note }),
  },
});

export const waitKeys = (pattern: string, timeoutMs: number): Step => ({
  waitKeys: pattern,
  timeoutMs,
});

export const sleepMs = (ms: number): Step => ({ sleepMs: ms });

export const print = (text: string): Step => ({ print: text });

export const statusRows = (rows: string[]): Step => ({ statusRows: rows });

/** The steps that write the four loop files, the engine file included. */
export function armSteps(spec: LoopSpec): Step[] {
  return [
    writeFile("ROADMAP.md", roadmapText(spec, "in progress")),
    writeFile(progressRel(spec), progressText(spec, "in progress")),
    writeFile(prdRel(spec), prdText(spec)),
    writeFile(ENGINE_REL, engineText(spec, `${spec.slug}-original`)),
  ];
}

/** The steps that mark the unit built, then print the completion promise the supervisor looks for. */
export function finishSteps(spec: LoopSpec): Step[] {
  return [
    writeFile("ROADMAP.md", roadmapText(spec, "built, awaiting /ship")),
    writeFile(
      progressRel(spec),
      progressText(spec, "built, awaiting /ship (committed 1234567)"),
    ),
    print(`<promise>ROADMAP COMPLETE ${spec.slug}</promise>`),
  ];
}
