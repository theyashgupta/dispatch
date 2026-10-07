import type {
  LoopEngine,
  LoopGate,
  LoopPhase,
  LoopProgress,
  LoopUnit,
  LoopUnitStatus,
} from "../../../shared/types.js";

interface RoadmapUnit {
  number: number;
  title: string;
  status: LoopUnitStatus;
  statusText: string;
  prdPath: string | null;
}

interface ProgressRow {
  ticket: string | null;
  branch: string | null;
  statusText: string | null;
  commit: string | null;
}

interface ProgressFile {
  roadmapPath: string | null;
  units: Map<number, ProgressRow>;
  warnings: string[];
}

interface PrdPhase {
  number: number;
  name: string;
}

interface PassLine {
  phase: number;
  at: string;
}

interface AttemptLine {
  phase: number;
  attempt: number;
  at: string;
}

interface EngineParse {
  engine: LoopEngine | null;
  reason: string | null;
}

interface UnitFilePaths {
  paths: string[];
  warnings: string[];
}

interface LoopProgressInput {
  slug: string;
  roadmapFile: string;
  readAt: string;
  roadmapText: string | null;
  progressText: string | null;
  engine: { text: string; closed: boolean } | null;
  files: ReadonlyMap<string, string | null>;
  refused: ReadonlySet<string>;
  warnings: string[];
}

const STATUSES: readonly LoopUnitStatus[] = [
  "not started",
  "in progress",
  "built, awaiting /ship",
  "shipped",
  "blocked",
];

const DONE_STATUSES: readonly LoopUnitStatus[] = [
  "built, awaiting /ship",
  "shipped",
];

const STATE_EXPECTED: readonly LoopUnitStatus[] = [
  "in progress",
  "built, awaiting /ship",
  "shipped",
];

const PLANNING = ".planning/";
const MAX_ITEMS = 99;
const MAX_WARNINGS = 50;
const MAX_WARNING_CHARS = 300;
const HANDOFF_PENDING = "handoff-pending";

export const ENGINE_FILE = ".claude/ralph-loop.local.md";

function toLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function toStatus(statusText: string): LoopUnitStatus {
  const head = (statusText.split("(")[0] ?? "").trim();
  return STATUSES.find((status) => status === head) ?? "unknown";
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function emptyCell(cell: string | undefined): boolean {
  return cell === undefined || cell === "" || cell === "-";
}

interface ParsedRoadmap {
  units: RoadmapUnit[];
  capped: boolean;
}

let lastRoadmap: { text: string; parsed: ParsedRoadmap } | null = null;

/**
 * Reads the unit blocks of a roadmap file, keeping the first 99.
 *
 * @remarks A block runs from its `### Unit <N>: <title>` heading to the next `##` or `###` heading. The last result is memoized because one read parses the same text twice.
 */
export function parseRoadmap(text: string): ParsedRoadmap {
  if (lastRoadmap?.text === text) return lastRoadmap.parsed;
  const units: RoadmapUnit[] = [];
  let capped = false;
  let current: RoadmapUnit | null = null;
  let seenStatus = false;
  let seenPrd = false;
  for (const line of toLines(text)) {
    const heading = /^### Unit (\d{1,4}): (.+)$/.exec(line);
    if (heading) {
      if (units.length >= MAX_ITEMS) {
        capped = true;
        break;
      }
      current = {
        number: Number(heading[1]),
        title: (heading[2] ?? "").trim(),
        status: "unknown",
        statusText: "",
        prdPath: null,
      };
      units.push(current);
      seenStatus = false;
      seenPrd = false;
      continue;
    }
    if (current === null) continue;
    if (/^##+ /.test(line)) {
      current = null;
      continue;
    }
    const status = /^- \*\*Status:\*\*(.*)$/.exec(line);
    if (status && !seenStatus) {
      seenStatus = true;
      current.statusText = (status[1] ?? "").trim();
      current.status = toStatus(current.statusText);
      continue;
    }
    const prd = /^- \*\*PRD:\*\*(.*)$/.exec(line);
    if (prd && !seenPrd) {
      seenPrd = true;
      current.prdPath = /`([^`]+)`/.exec(prd[1] ?? "")?.[1] ?? null;
    }
  }
  const parsed = { units, capped };
  lastRoadmap = { text, parsed };
  return parsed;
}

/**
 * Reads the first line and the units table of a progress ledger.
 *
 * @remarks Columns are found by header name because every roadmap session lays the table out differently.
 */
export function parseProgressFile(text: string): ProgressFile {
  const lines = toLines(text);
  const first = lines[0] ?? "";
  const roadmapPath = first.startsWith("Roadmap: ")
    ? (first.slice("Roadmap: ".length).split(/,| \| /)[0] ?? "").trim() || null
    : null;
  const units = new Map<number, ProgressRow>();
  const warnings: string[] = [];

  const headerAt = lines.findIndex(
    (line) => line.trim().startsWith("|") && tableCells(line).includes("Unit"),
  );
  if (headerAt === -1) {
    return { roadmapPath, units, warnings: ["no units table"] };
  }

  const header = tableCells(lines[headerAt] ?? "");
  const column = (name: string): number => header.indexOf(name);
  const unitCol = column("Unit");
  const ticketCol = column("Ticket");
  const branchCol = column("Branch");
  const statusCol = column("Status");

  for (const [offset, line] of lines.slice(headerAt + 1).entries()) {
    if (!line.trim().startsWith("|")) break;
    if (/^[\s|:-]+$/.test(line)) continue;
    const cells = tableCells(line);
    const unitCell = cells[unitCol] ?? "";
    if (cells.length !== header.length || !/^\d+$/.test(unitCell)) {
      warnings.push(`malformed row ${headerAt + 2 + offset}`);
      continue;
    }
    const number = Number(unitCell);
    if (units.has(number)) continue;

    const branchCell = branchCol === -1 ? undefined : cells[branchCol];
    const branch = emptyCell(branchCell)
      ? null
      : (branchCell?.split(/\s+/)[0]?.replace(/`/g, "") ?? null) || null;
    const ticketCell = ticketCol === -1 ? undefined : cells[ticketCol];
    const ticket = emptyCell(ticketCell)
      ? (/[A-Z][A-Z0-9]{0,15}-\d+/.exec(branch ?? "")?.[0] ?? null)
      : (ticketCell ?? null);
    const statusCell = statusCol === -1 ? undefined : cells[statusCol];
    const statusText = statusCell === undefined ? null : statusCell;
    const commit =
      /committed ([0-9a-f]{7,40})\b/i.exec(statusText ?? "")?.[1] ?? null;
    units.set(number, { ticket, branch, statusText, commit });
  }
  return { roadmapPath, units, warnings };
}

/** Lists the `### Phase <N>: <name>` headings of a PRD in file order, keeping the first 99. */
export function parsePhases(text: string): {
  phases: PrdPhase[];
  capped: boolean;
} {
  const phases: PrdPhase[] = [];
  for (const line of toLines(text)) {
    const match = /^### Phase (\d{1,4}): (.+)$/.exec(line);
    if (!match) continue;
    if (phases.length >= MAX_ITEMS) return { phases, capped: true };
    phases.push({ number: Number(match[1]), name: (match[2] ?? "").trim() });
  }
  return { phases, capped: false };
}

/**
 * Lists the `gate=pass` lines of a unit state file.
 */
export function parseStateLines(text: string): PassLine[] {
  const lines: PassLine[] = [];
  for (const line of toLines(text)) {
    const match = /^phase (\d+) (.+) GREEN (\S+) gate=pass$/.exec(line.trim());
    if (match) lines.push({ phase: Number(match[1]), at: match[3] ?? "" });
  }
  return lines;
}

/**
 * Lists the RED attempt lines of a unit attempts file.
 */
export function parseAttemptLines(text: string): AttemptLine[] {
  const lines: AttemptLine[] = [];
  for (const line of toLines(text)) {
    const match = /^phase (\d+) RED attempt (\d+) (\S+)/.exec(line.trim());
    if (match) {
      lines.push({
        phase: Number(match[1]),
        attempt: Number(match[2]),
        at: match[3] ?? "",
      });
    }
  }
  return lines;
}

/**
 * Reads the front matter of a ralph loop engine file.
 *
 * @remarks A file with fewer than two `---` lines returns a null engine and a reason for the caller to warn with.
 */
export function parseEngineFile(text: string, closed: boolean): EngineParse {
  const lines = toLines(text);
  const fences: number[] = [];
  lines.forEach((line, index) => {
    if (line.trim() === "---" && fences.length < 2) fences.push(index);
  });
  const start = fences[0];
  const end = fences[1];
  if (start === undefined || end === undefined) {
    return { engine: null, reason: "no front matter" };
  }
  const fields = new Map<string, string>();
  for (const line of lines.slice(start + 1, end)) {
    const match = /^([A-Za-z_]+):(.*)$/.exec(line);
    if (match) fields.set(match[1] ?? "", stripQuotes((match[2] ?? "").trim()));
  }
  const iteration = /^-?\d+$/.test(fields.get("iteration") ?? "")
    ? Number(fields.get("iteration"))
    : null;
  const sessionId = fields.get("session_id") || null;
  if (!fields.has("active")) {
    return { engine: null, reason: "no active field" };
  }
  return {
    engine: {
      active: fields.get("active") === "true",
      iteration,
      sessionId,
      handoffPending: sessionId === HANDOFF_PENDING,
      startedAt: fields.get("started_at") || null,
      closed,
    },
    reason: null,
  };
}

/**
 * Returns the relative folder that holds a unit's state and attempts files, or null when the PRD path has no `.planning/` folder.
 */
export function phaseDir(
  prdPath: string,
  slug: string,
  unit: number,
): string | null {
  const at = prdPath.indexOf(PLANNING);
  if (at === -1) return null;
  return `${prdPath.slice(0, at)}${PLANNING}${slug}-unit-${unit}`;
}

/** Returns the relative path of one ledger file of a loop slug. */
export function loopFilePath(slug: string, name: string): string {
  return `.roadmap/${slug}/${name}`;
}

/**
 * Returns the relative path of the progress ledger of a loop slug.
 */
export function progressPathOf(slug: string): string {
  return loopFilePath(slug, "progress.md");
}

/**
 * Returns the message of an error, or a fixed text for a value that is not an error.
 */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : "unreadable";
}

function phasePaths(
  prdPath: string,
  slug: string,
  unit: number,
): { state: string; attempts: string } | null {
  const dir = phaseDir(prdPath, slug, unit);
  return dir === null
    ? null
    : { state: `${dir}/state.md`, attempts: `${dir}/attempts.md` };
}

/**
 * Lists the relative file paths a loop read must fetch for each unit of a roadmap.
 *
 * @remarks A PRD path without `.planning/` yields no phase paths and one warning.
 */
export function unitFilePaths(
  roadmapText: string,
  slug: string,
): UnitFilePaths {
  const paths: string[] = [];
  const warnings: string[] = [];
  for (const unit of parseRoadmap(roadmapText).units) {
    if (unit.prdPath === null) continue;
    paths.push(unit.prdPath);
    const phase = phasePaths(unit.prdPath, slug, unit.number);
    if (phase === null) {
      warnings.push(`${unit.prdPath}: no ${PLANNING} folder in the PRD path`);
      continue;
    }
    paths.push(phase.state, phase.attempts);
  }
  return { paths, warnings };
}

function isBinaryLooking(text: string): boolean {
  if (text.includes("\0")) return true;
  let control = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) control++;
  }
  return control > text.length * 0.1;
}

function newest<T extends { at: string }>(items: T[]): T | null {
  let best: T | null = null;
  for (const item of items) {
    if (best === null || item.at > best.at) best = item;
  }
  return best;
}

interface UnitEvidence {
  passes: PassLine[];
  attempts: AttemptLine[];
}

interface ReadContext {
  warnings: string[];
  refused: ReadonlySet<string>;
}

function gateOf(unit: number, evidence: UnitEvidence): LoopGate | null {
  const candidates: LoopGate[] = [
    ...evidence.passes.map((line): LoopGate => ({
      unit,
      phase: line.phase,
      result: "pass",
      at: line.at,
    })),
    ...evidence.attempts.map((line): LoopGate => ({
      unit,
      phase: line.phase,
      result: "fail",
      at: line.at,
    })),
  ];
  return newest(candidates);
}

function warnMissing(ctx: ReadContext, path: string): void {
  if (!ctx.refused.has(path)) ctx.warnings.push(`${path}: missing`);
}

/**
 * Parses one file text, or returns null after a warning when the text cannot be parsed.
 *
 * @remarks A null text adds no warning because the caller decides whether a missing file matters.
 */
function parseText<T>(
  ctx: ReadContext,
  path: string,
  text: string | null,
  parse: (text: string) => T,
): T | null {
  if (text === null) return null;
  if (text.trim() === "") {
    if (!ctx.refused.has(path)) ctx.warnings.push(`${path}: empty`);
    return null;
  }
  if (isBinaryLooking(text)) {
    ctx.warnings.push(`${path}: not text`);
    return null;
  }
  try {
    return parse(text);
  } catch (error) {
    ctx.warnings.push(`${path}: ${reasonOf(error)}`);
    return null;
  }
}

function readRoadmap(
  ctx: ReadContext,
  input: LoopProgressInput,
): RoadmapUnit[] {
  if (input.roadmapText === null) {
    warnMissing(ctx, input.roadmapFile);
    return [];
  }
  const parsed = parseText(
    ctx,
    input.roadmapFile,
    input.roadmapText,
    parseRoadmap,
  );
  if (parsed === null) return [];
  if (parsed.units.length === 0) {
    ctx.warnings.push(`${input.roadmapFile}: no unit headings`);
  }
  if (parsed.capped) {
    ctx.warnings.push(
      `${input.roadmapFile}: more than ${MAX_ITEMS} units, the rest are skipped`,
    );
  }
  return parsed.units;
}

function readRows(
  ctx: ReadContext,
  input: LoopProgressInput,
): Map<number, ProgressRow> {
  const path = progressPathOf(input.slug);
  if (input.progressText === null) warnMissing(ctx, path);
  const parsed = parseText(ctx, path, input.progressText, parseProgressFile);
  if (parsed === null) return new Map();
  for (const reason of parsed.warnings) ctx.warnings.push(`${path}: ${reason}`);
  return parsed.units;
}

function readEngine(
  ctx: ReadContext,
  input: LoopProgressInput,
): LoopEngine | null {
  if (input.engine === null) return null;
  const { text, closed } = input.engine;
  const path = closed ? `${ENGINE_FILE}.done` : ENGINE_FILE;
  const parsed = parseText(ctx, path, text, (body) =>
    parseEngineFile(body, closed),
  );
  if (parsed?.reason) ctx.warnings.push(`${path}: ${parsed.reason}`);
  return parsed?.engine ?? null;
}

function phasesOf(headings: PrdPhase[], evidence: UnitEvidence): LoopPhase[] {
  return headings.map((heading): LoopPhase => {
    const passed = newest(
      evidence.passes.filter((line) => line.phase === heading.number),
    );
    const tries = evidence.attempts.filter(
      (line) => line.phase === heading.number,
    ).length;
    return {
      number: heading.number,
      name: heading.name,
      gate: passed ? "pass" : tries > 0 ? "fail" : "pending",
      attempts: tries,
      passedAt: passed?.at ?? null,
    };
  });
}

function readEvidence(
  ctx: ReadContext,
  input: LoopProgressInput,
  unit: LoopUnit,
  prdPath: string,
): UnitEvidence {
  const evidence: UnitEvidence = { passes: [], attempts: [] };
  const paths = phasePaths(prdPath, input.slug, unit.number);
  if (paths === null) return evidence;
  const stateText = input.files.get(paths.state) ?? null;
  if (stateText === null && STATE_EXPECTED.includes(unit.status)) {
    warnMissing(ctx, paths.state);
  }
  evidence.passes =
    parseText(ctx, paths.state, stateText, parseStateLines) ?? [];
  evidence.attempts =
    parseText(
      ctx,
      paths.attempts,
      input.files.get(paths.attempts) ?? null,
      parseAttemptLines,
    ) ?? [];
  return evidence;
}

function buildUnit(
  ctx: ReadContext,
  input: LoopProgressInput,
  roadmapUnit: RoadmapUnit,
  row: ProgressRow | undefined,
  evidenceByUnit: Map<number, UnitEvidence>,
): LoopUnit {
  const unit: LoopUnit = {
    number: roadmapUnit.number,
    ticket: row?.ticket ?? null,
    title: roadmapUnit.title,
    status: roadmapUnit.status,
    statusText: roadmapUnit.statusText,
    branch: row?.branch ?? null,
    commit: row?.commit ?? null,
    prdPath: roadmapUnit.prdPath,
    phaseTotal: null,
    phases: [],
  };
  const prdPath = roadmapUnit.prdPath;
  if (prdPath === null) return unit;

  const prdText = input.files.get(prdPath) ?? null;
  if (prdText === null) warnMissing(ctx, prdPath);
  const parsedPhases = parseText(ctx, prdPath, prdText, parsePhases);
  const headings = parsedPhases?.phases ?? null;
  const evidence = readEvidence(ctx, input, unit, prdPath);
  evidenceByUnit.set(unit.number, evidence);
  if (headings === null) return unit;
  if (headings.length === 0) {
    ctx.warnings.push(`${prdPath}: no phase headings`);
    return unit;
  }
  if (parsedPhases?.capped) {
    ctx.warnings.push(
      `${prdPath}: more than ${MAX_ITEMS} phases, the rest are skipped`,
    );
  }
  unit.phaseTotal = headings.length;
  unit.phases = phasesOf(headings, evidence);
  return unit;
}

function summarize(
  units: LoopUnit[],
  evidenceByUnit: Map<number, UnitEvidence>,
  running: boolean,
): Pick<LoopProgress, "completion" | "summary"> {
  const done = units.filter((unit) => DONE_STATUSES.includes(unit.status));
  const current = units
    .filter((unit) => unit.status === "in progress")
    .sort((a, b) => a.number - b.number)[0];
  const lastDone = [...done].sort((a, b) => b.number - a.number)[0];
  const gateFor = (unit: LoopUnit | undefined): LoopGate | null =>
    unit === undefined
      ? null
      : gateOf(
          unit.number,
          evidenceByUnit.get(unit.number) ?? { passes: [], attempts: [] },
        );
  const currentPhase = current
    ? ([...current.phases]
        .sort((a, b) => a.number - b.number)
        .find((phase) => phase.gate !== "pass") ?? null)
    : null;
  const completion =
    units.length > 0 && done.length === units.length
      ? "complete"
      : current !== undefined || running
        ? "running"
        : "not_started";
  return {
    completion,
    summary: {
      unitsDone: done.length,
      unitsTotal: units.length,
      currentUnit: current?.number ?? null,
      currentPhase: currentPhase
        ? { number: currentPhase.number, name: currentPhase.name }
        : null,
      lastGate: gateFor(current) ?? gateFor(lastDone),
    },
  };
}

function capWarnings(warnings: string[]): string[] {
  const cut = warnings.map((warning) =>
    warning.length > MAX_WARNING_CHARS
      ? `${warning.slice(0, MAX_WARNING_CHARS - 3)}...`
      : warning,
  );
  if (cut.length <= MAX_WARNINGS) return cut;
  return [
    ...cut.slice(0, MAX_WARNINGS - 1),
    `${cut.length - (MAX_WARNINGS - 1)} more warnings`,
  ];
}

/**
 * Builds the loop model from the already read texts of one session root.
 *
 * @remarks Each file parses on its own, so one malformed file adds a warning and never blocks the rest. The warning list is capped.
 */
export function buildLoopProgress(input: LoopProgressInput): LoopProgress {
  const ctx: ReadContext = {
    warnings: [...input.warnings],
    refused: input.refused,
  };
  const roadmapUnits = readRoadmap(ctx, input);
  const rows = readRows(ctx, input);
  const engine = readEngine(ctx, input);
  const evidenceByUnit = new Map<number, UnitEvidence>();
  const units = roadmapUnits.map((roadmapUnit) =>
    buildUnit(
      ctx,
      input,
      roadmapUnit,
      rows.get(roadmapUnit.number),
      evidenceByUnit,
    ),
  );
  const running = engine !== null && engine.active && !engine.closed;
  return {
    slug: input.slug,
    roadmapFile: input.roadmapFile,
    units,
    engine,
    ...summarize(units, evidenceByUnit, running),
    warnings: capWarnings(ctx.warnings),
    readAt: input.readAt,
  };
}
