import { STALE_MINUTES } from "../../../shared/orchestrator-limits.js";
import type { LoopProgress, SupervisorState } from "../../../shared/types.js";
import { parseLimitSurface, type LimitSurface } from "./limit-surface.js";

export type PromptKind = "dangerous_delete" | "peer_message" | "other";

export interface DetectMemory {
  state: SupervisorState | null;
  dialogKey: string | null;
  idleSamples: { at: number; body: string }[];
  transcriptSize: number | null;
  lastGrowthAt: number | null;
  restored: boolean;
}

export interface DetectInput {
  now: number;
  tmuxAlive: boolean;
  atShellPrompt: boolean;
  pane: string;
  engineSessionId: string | null;
  completion: LoopProgress["completion"] | null;
  transcript: { size: number; lastAssistantText: string | null } | null;
  memory: DetectMemory;
}

export interface Detection {
  state: SupervisorState;
  evidence: string;
  promptKind?: PromptKind;
  busy?: true;
  memory: DetectMemory;
}

interface Dialog {
  state: SupervisorState;
  key: string;
  evidence: string;
  promptKind?: PromptKind;
}

const IDLE_SAMPLE_MS = 60_000;
const IDLE_SAMPLES = 3;
const STALE_MS = STALE_MINUTES * 60_000;
const EVIDENCE_MAX = 160;

const INPUT_LINE = /^\s*❯(?!\s*\d+\.)(?!\s*Deny\b)/;
const USER_BLOCK_START = /^\s*❯(?!\s*\d+\.)\s*\S/;
const BLOCK_START = /^[⏺✻✽✶✳✢·※]/;
const SPINNER_LINE = /^\s*[✻✽✶✳✢·]\s/;
const RUNNING_SPINNER = /^[✻✽✶✳✢·]\s+\S.*…/;
const TOOL_RUNNING = /^\s*⎿\s+Running…/;
const FOOTER_BUSY = /esc to interrupt|│\s*░+\s+warming up/i;
const BACKGROUND_WAIT = /^[✻✽✶✳✢·]\s+Waiting for \d+ background/;
const LIMIT_ROW = /limit to reset|continue automatically at\b/i;
const POINTER_ROW = /^\s*❯\s*\d+\.\s+\S/;
const PERMISSION_QUESTION = /Do you want to (proceed\?|make|create|allow)/;
const DANGEROUS_RM = /Dangerous rm operation/;
const PEER_DELIVER = /Deliver this message to Claude/;
const PEER_DENY = /^\s*❯\s*Deny\b/;
const ESC_TO_CANCEL = /Esc to cancel/i;
const RULE_LINE = /^\s*─{3,}/;
const MODE_ROW = /^[!#&]/;
const NEEDS_INPUT_MARKER = /^\s*DISPATCH_STATUS:\s*NEEDS_INPUT\b/;
const HANDOFF_LINE = /^\s*(⏺\s*)?HANDOFF_READY\s+[\w.-]+\s*$/;
const COMPLETE_PROMISE = /<promise>ROADMAP COMPLETE\b/;
const API_ERROR_HEAD = /^\s*⏺\s*API Error\b/;
const LIMIT_RESET_LINE = /limit\b.*\bresets?\s+\S/i;

/** Trim a pane line into a one-line evidence string with a source prefix. */
function evidence(source: string, line: string): string {
  const text = line.trim().replace(/\s+/g, " ");
  return `${source}: ${text.length > EVIDENCE_MAX ? `${text.slice(0, EVIDENCE_MAX)}…` : text}`;
}

/**
 * Drop user prompt blocks so a marker typed or pasted by a human never counts as agent output.
 *
 * @remarks A block runs from a non-empty `❯` input line to the next agent, spinner or recap line
 * in column 0. User continuation lines are indented, so a glyph inside a prompt never ends it.
 */
function agentLines(lines: readonly string[]): string[] {
  const kept: string[] = [];
  let inUser = false;
  for (const line of lines) {
    if (USER_BLOCK_START.test(line)) inUser = true;
    else if (BLOCK_START.test(line)) inUser = false;
    if (!inUser) kept.push(line);
  }
  return kept;
}

/** Return the lines of the newest `⏺` block, or an empty list when the pane shows none. */
function lastAgentBlock(lines: readonly string[]): string[] {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^⏺/.test(lines[i])) {
      const end = lines.findIndex((l, j) => j > i && BLOCK_START.test(l));
      return lines.slice(i, end < 0 ? lines.length : end);
    }
  }
  return [];
}

/**
 * Classify the dialog under the last input line, if one is open.
 *
 * @remarks The region below the input line is where Claude Code draws dialogs, so a dialog quoted
 * higher up in the conversation never matches. The key covers only the stable rows, not timers.
 */
function openDialog(region: readonly string[]): Dialog | null {
  const text = region.join("\n");
  const limit = parseLimitSurface(text);
  if (limit?.kind === "b" && limit.options.some((o) => LIMIT_ROW.test(o))) {
    return {
      state: "usage_limit_dialog",
      key: `limit:${limit.options.join("|")}:${limit.cursor}`,
      evidence: evidence("pane", limit.options.join(" / ")),
    };
  }
  const rows = region.filter(
    (l) => /^\s*❯?\s*\d+\.\s/.test(l) || PEER_DENY.test(l),
  );
  const rowKey = rows.map((r) => r.trim()).join("|");
  if (PEER_DELIVER.test(text) && region.some((l) => PEER_DENY.test(l))) {
    return {
      state: "permission_prompt",
      key: `peer:${rowKey}`,
      evidence: evidence("pane", "Held message from another session"),
      promptKind: "peer_message",
    };
  }
  const question = region.findIndex((l) => PERMISSION_QUESTION.test(l));
  if (
    question >= 0 &&
    region.slice(question).some((l) => POINTER_ROW.test(l))
  ) {
    const danger = region.find((l) => DANGEROUS_RM.test(l));
    return {
      state: "permission_prompt",
      key: `perm:${(danger ?? "").trim()}:${region[question].trim()}:${rowKey}`,
      evidence: evidence("pane", danger ?? region[question]),
      promptKind: danger ? "dangerous_delete" : "other",
    };
  }
  if (limit?.kind === "a") {
    const line = region.find((l) => /continuing automatically/i.test(l)) ?? "";
    return {
      state: "usage_limit_wait",
      key: `auto:${line.trim()}`,
      evidence: evidence("pane", line),
    };
  }
  const pointer = region.findIndex((l) => POINTER_ROW.test(l));
  if (
    pointer >= 0 &&
    region.slice(pointer).some((l) => ESC_TO_CANCEL.test(l))
  ) {
    return {
      state: "needs_input",
      key: `menu:${rowKey}`,
      evidence: evidence("pane", region[pointer]),
    };
  }
  return null;
}

/** The index of the last input line of a pane, or -1 when none is drawn. */
function inputLineAt(lines: readonly string[]): number {
  let at = -1;
  lines.forEach((l, i) => {
    if (INPUT_LINE.test(l)) at = i;
  });
  return at;
}

/**
 * Whether the input box row is the prompt line at `inputAt`, not a row left in an input mode.
 *
 * @remarks The box row is the first row between the last two rule lines. A capture with no such
 * rules falls back to refusing a row that starts with `!`, `#` or `&` under the prompt line, as
 * a box in bash, memory or background mode draws that character in place of the prompt.
 */
function promptIsInputRow(lines: readonly string[], inputAt: number): boolean {
  const rules = lines.flatMap((l, i) => (RULE_LINE.test(l) ? [i] : []));
  if (rules.length >= 2) return (rules.at(-2) ?? -1) + 1 === inputAt;
  return !lines.slice(inputAt + 1).some((l) => MODE_ROW.test(l));
}

/**
 * Whether a typed line would land in the input box: an input line is drawn as the box row, nothing
 * below it says `warming up`, and no dialog or menu is open under it.
 *
 * @remarks A dialog draws under the input line, and an `Enter` or a digit typed into it would pick a
 * row, a credits row of the usage limit menu included. A box left in bash mode would run the line
 * as a shell command.
 */
export function paneReady(pane: string): boolean {
  const lines = pane.split("\n");
  const inputAt = inputLineAt(lines);
  if (inputAt < 0 || !promptIsInputRow(lines, inputAt)) return false;
  const below = lines.slice(inputAt + 1);
  return (
    openDialog(below) === null &&
    !below.some(
      (l) =>
        /warming up/.test(l) || POINTER_ROW.test(l) || ESC_TO_CANCEL.test(l),
    )
  );
}

/**
 * Read the usage limit surface below the last input line, the same region `detectState` reads.
 *
 * @remarks A menu counts only with a limit row, so an agent menu with a `Stop` row is never
 * answered as the limit dialog.
 */
export function limitSurfaceOf(pane: string): LimitSurface | null {
  const lines = pane.split("\n");
  const inputAt = inputLineAt(lines);
  const surface = parseLimitSurface(lines.slice(inputAt + 1).join("\n"));
  if (surface?.kind === "b" && !surface.options.some((o) => LIMIT_ROW.test(o)))
    return null;
  return surface;
}

/** Whether a pane shows an active turn: a running spinner or tool, a background agent wait, or a busy footer. */
export function paneBusy(pane: string): boolean {
  const lines = pane.split("\n");
  const inputAt = inputLineAt(lines);
  return (
    lines.some(
      (l) =>
        RUNNING_SPINNER.test(l) ||
        TOOL_RUNNING.test(l) ||
        BACKGROUND_WAIT.test(l),
    ) ||
    (inputAt >= 0 && lines.slice(inputAt + 1).some((l) => FOOTER_BUSY.test(l)))
  );
}

/** Advance the idle samples: keep one sample per 60 s while the stable body stays equal. */
function nextSamples(
  samples: DetectMemory["idleSamples"],
  body: string,
  now: number,
): DetectMemory["idleSamples"] {
  const last = samples.at(-1);
  if (!last || last.body !== body) return [{ at: now, body }];
  if (now - last.at < IDLE_SAMPLE_MS) return samples;
  return [...samples, { at: now, body }].slice(-IDLE_SAMPLES);
}

/**
 * Start the detection memory of one session; the caller keeps one per tmux session.
 *
 * @remarks A stored state passed in after a server restart is held while the pane stays as it
 * was, so a quiet session does not read as `working` until idle is confirmed again.
 */
export function initialMemory(
  stored: SupervisorState | null = null,
): DetectMemory {
  return {
    state: stored,
    dialogKey: null,
    idleSamples: [],
    transcriptSize: null,
    lastGrowthAt: null,
    restored: stored !== null,
  };
}

/**
 * Name the supervisor state of one session from one pane sample and its file sources.
 *
 * @remarks No action state comes from a single text match (U2-06): handoff needs the engine file,
 * completion needs the progress model, a dialog needs two agreeing captures and idle needs three
 * equal samples 60 s apart. The caller stores the returned memory and passes it to the next call.
 */
export function detectState(input: DetectInput): Detection {
  const { now, memory, transcript } = input;
  const grew =
    transcript !== null &&
    memory.transcriptSize !== null &&
    transcript.size > memory.transcriptSize;
  const base: DetectMemory = {
    state: memory.state,
    dialogKey: null,
    idleSamples: [],
    transcriptSize: transcript?.size ?? memory.transcriptSize,
    lastGrowthAt:
      transcript !== null && (grew || memory.lastGrowthAt === null)
        ? now
        : memory.lastGrowthAt,
    restored: false,
  };
  const done = (
    state: SupervisorState,
    why: string,
    extra: Partial<Detection> = {},
    mem: Partial<DetectMemory> = {},
  ): Detection => ({
    state,
    evidence: why,
    ...extra,
    memory: { ...base, ...mem, state },
  });

  if (!input.tmuxAlive) return done("lost", "tmux: session not found");
  if (input.atShellPrompt)
    return done("shell_prompt", "tmux: pane at shell prompt");

  const lines = input.pane.split("\n");
  const inputAt = inputLineAt(lines);
  const dialog = openDialog(inputAt >= 0 ? lines.slice(inputAt + 1) : lines);
  if (dialog && dialog.key === memory.dialogKey) {
    return done(
      dialog.state,
      dialog.evidence,
      dialog.promptKind ? { promptKind: dialog.promptKind } : {},
      { dialogKey: dialog.key },
    );
  }
  const dialogMem = { dialogKey: dialog?.key ?? null };

  const transcriptLines = agentLines(
    inputAt >= 0 ? lines.slice(0, inputAt) : lines,
  );
  const promise = transcriptLines.find((l) => COMPLETE_PROMISE.test(l));
  if (promise && input.completion === "complete") {
    return done("roadmap_complete", evidence("pane", promise), {}, dialogMem);
  }
  const handoff = transcriptLines.find((l) => HANDOFF_LINE.test(l));
  if (handoff && input.engineSessionId === "handoff-pending") {
    return done("handoff_ready", evidence("pane", handoff), {}, dialogMem);
  }

  const footer = inputAt >= 0 ? lines.slice(inputAt + 1) : [];
  const activeLine =
    lines.find((l) => RUNNING_SPINNER.test(l) || TOOL_RUNNING.test(l)) ??
    footer.find((l) => FOOTER_BUSY.test(l));
  const activeTurn = activeLine !== undefined;
  const busyLine = activeLine ?? lines.find((l) => BACKGROUND_WAIT.test(l));
  const busy = busyLine !== undefined || grew;
  const block = lastAgentBlock(transcriptLines);
  if (
    block.length > 0 &&
    API_ERROR_HEAD.test(block[0]) &&
    !activeTurn &&
    !grew
  ) {
    return done("api_error", evidence("pane", block[0]), {}, dialogMem);
  }
  const marker = block.find((l) => NEEDS_INPUT_MARKER.test(l));
  if (marker && !busy) {
    return done("needs_input", evidence("pane", marker), {}, dialogMem);
  }
  const resetLine = [...transcriptLines]
    .reverse()
    .find((l) => LIMIT_RESET_LINE.test(l));
  if (
    resetLine &&
    !busy &&
    (memory.state === "usage_limit_dialog" ||
      memory.state === "usage_limit_wait")
  ) {
    return done("usage_limit_wait", evidence("pane", resetLine), {}, dialogMem);
  }

  if (busy) {
    if (
      transcript !== null &&
      base.lastGrowthAt !== null &&
      now - base.lastGrowthAt >= STALE_MS
    ) {
      const minutes = Math.floor((now - base.lastGrowthAt) / 60_000);
      return done(
        "stale",
        `transcript: no growth for ${minutes} min while working`,
        {},
        dialogMem,
      );
    }
    const sign = grew
      ? "transcript: grew since the last sample"
      : evidence("pane", busyLine ?? "");
    return done("working", sign, { busy: true }, dialogMem);
  }

  const body = transcriptLines.filter((l) => !SPINNER_LINE.test(l)).join("\n");
  const idleSamples = dialog ? [] : nextSamples(memory.idleSamples, body, now);
  const mem = { ...dialogMem, idleSamples };
  if (idleSamples.length >= IDLE_SAMPLES) {
    const question = transcript?.lastAssistantText?.trimEnd().endsWith("?");
    if (question) {
      return done(
        "needs_input",
        "transcript: last assistant message asks a question",
        {},
        mem,
      );
    }
    return done(
      "idle",
      `pane: unchanged in ${IDLE_SAMPLES} samples 60 s apart`,
      {},
      mem,
    );
  }
  const unchanged =
    memory.idleSamples.length === 0 || memory.idleSamples.at(-1)?.body === body;
  if (
    memory.restored &&
    unchanged &&
    (memory.state === "idle" || memory.state === "needs_input")
  ) {
    return done(
      memory.state,
      "restart: stored state kept while the pane is unchanged",
      {},
      { ...mem, restored: true },
    );
  }
  return done("working", "pane: no busy sign, idle not confirmed yet", {}, mem);
}
