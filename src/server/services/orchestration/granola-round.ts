import { run } from "../../adapters/exec.js";
import { resolveBinaryPath } from "../../adapters/resolve-binary.js";
import { store } from "../../store/board.store.js";
import {
  DEFAULT_GRANOLA_WINDOW_HOURS,
  type GranolaCheckResult,
  type GranolaStatus,
} from "../../../shared/types.js";
import {
  GRANOLA_UNAVAILABLE,
  RUN_INTERVAL_MS,
  buildGranolaPrompt,
  granolaToolName,
  groupByMeeting,
  nextRunDelay,
  parseMcpList,
  roundSince,
  type GranolaCheck,
} from "../domain/granola-actions.js";
import {
  buildMeetingItems,
  localDate,
  parseActionItems,
} from "../domain/meeting-actions.js";
import { getOrchestrationConfig } from "../infra/config-holder.js";
import { DISPATCH_DIR } from "../infra/paths.js";

export type GranolaRunResult = "started" | "running" | "disabled";

const CURSOR_KEY = "granola";
const LIST_TIMEOUT_MS = 60_000;
const ROUND_TIMEOUT_MS = 300_000;
const KILL_GRACE_MS = 5_000;

let timer: NodeJS.Timeout | null = null;
let controller: AbortController | null = null;
let current: Promise<void> | null = null;
let applying: Promise<void> = Promise.resolve();
let last: Pick<
  GranolaStatus,
  "lastRunAt" | "lastError" | "lastCount" | "server"
> = {};

/**
 * The meeting source settings from the held config, with the default window.
 */
export function granolaSettings(): { enabled: boolean; windowHours: number } {
  const meeting = getOrchestrationConfig()?.sources?.meeting;
  return {
    enabled: meeting?.enabled === true,
    windowHours: meeting?.windowHours ?? DEFAULT_GRANOLA_WINDOW_HOURS,
  };
}

/**
 * The polledAt of the last successful round, if any.
 */
function polledAt(): string | undefined {
  return store.getSourceCursors("meeting")[CURSOR_KEY]?.polledAt;
}

/**
 * The status the Granola routes answer; it never carries model output or stderr.
 */
export function granolaStatus(): GranolaStatus {
  const at = polledAt();
  return {
    ...granolaSettings(),
    running: current !== null,
    ...last,
    ...(at !== undefined ? { polledAt: at } : {}),
  };
}

/**
 * Drop the pending timer, if any.
 */
function clearTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

/**
 * Arm the timer for the next round, or leave it cleared when the source is off.
 */
function schedule(delayMs: number): void {
  clearTimer();
  if (!granolaSettings().enabled) return;
  timer = setTimeout(() => {
    timer = null;
    startRound();
  }, delayMs);
  timer.unref();
}

/**
 * Start a round unless one is running or the source is off.
 */
function startRound(): void {
  if (current !== null || !granolaSettings().enabled) return;
  const round = new AbortController();
  controller = round;
  current = runRound(round).finally(() => {
    current = null;
    controller = null;
    if (!round.signal.aborted || round.signal.reason === "timeout") {
      schedule(RUN_INTERVAL_MS);
    }
  });
}

/**
 * Stop the running round and wait until its child process has exited.
 */
async function abortRound(): Promise<void> {
  const running = current;
  controller?.abort("settings");
  await running;
}

/**
 * Run `claude mcp list` and read the Granola line from it.
 */
async function listGranola(
  claude: string,
  signal?: AbortSignal,
): Promise<GranolaCheck> {
  const list = await run(claude, ["mcp", "list"], {
    cwd: DISPATCH_DIR,
    timeout: LIST_TIMEOUT_MS,
    signal,
    killEscalationMs: KILL_GRACE_MS,
  });
  return parseMcpList(list.stdout);
}

/**
 * One Granola round: gate on `claude mcp list`, ask Claude with only the Granola tool allowed,
 * then upsert the items and advance the cursor.
 *
 * @remarks The round owns its 300 s limit as an abort with reason "timeout", because the exec
 * wrapper does not report which of a timeout or an abort ended the child. `--restricted` keeps
 * the user's settings files, and so their allow rules and default mode, out of the round.
 */
async function runRound(round: AbortController): Promise<void> {
  const signal = round.signal;
  const limit = setTimeout(() => round.abort("timeout"), ROUND_TIMEOUT_MS);
  const now = new Date();
  const finish = (fields: Partial<typeof last>): void => {
    last = {
      ...last,
      lastRunAt: new Date().toISOString(),
      lastCount: undefined,
      ...fields,
    };
  };
  try {
    const claude = await resolveBinaryPath("claude");
    if (claude === null) {
      finish({ lastError: "claude-missing", server: undefined });
      return;
    }
    const check = await listGranola(claude, signal);
    if (check.state !== "connected") {
      finish({
        lastError: check.state,
        server: "server" in check ? check.server : undefined,
      });
      return;
    }
    const server = check.server;
    const entry = store.getSourceCursors("meeting")[CURSOR_KEY];
    const { since, until } = roundSince(
      entry,
      granolaSettings().windowHours,
      now,
    );
    const { stdout } = await run(
      claude,
      [
        "-p",
        "--restricted",
        "--output-format",
        "text",
        "--model",
        "sonnet",
        "--tools",
        "",
        "--allowedTools",
        granolaToolName(server),
        "--no-session-persistence",
      ],
      {
        cwd: DISPATCH_DIR,
        timeout: ROUND_TIMEOUT_MS + KILL_GRACE_MS,
        maxBuffer: 10 * 1024 * 1024,
        signal,
        killEscalationMs: KILL_GRACE_MS,
        input: buildGranolaPrompt(since, until),
      },
    );
    if (stdout.trim() === GRANOLA_UNAVAILABLE) {
      finish({ lastError: "failed", server });
      return;
    }
    let drafts;
    try {
      drafts = parseActionItems(stdout);
    } catch {
      finish({ lastError: "unreadable", server });
      return;
    }
    const items = groupByMeeting(drafts, localDate(now)).flatMap((group) =>
      buildMeetingItems({ feed: "granola", ...group, now: now.toISOString() }),
    );
    if (items.length > 0) {
      await store.upsertItems("meeting", items, { kind: "append" });
    }
    await store.setSourceCursors("meeting", {
      [CURSOR_KEY]: {
        cursor: until.toISOString(),
        polledAt: now.toISOString(),
      },
    });
    finish({ lastError: undefined, lastCount: items.length, server });
  } catch {
    if (signal.reason === "settings") return;
    const code = signal.reason === "timeout" ? "timeout" : "failed";
    console.warn(`[granola] round ended with ${code}`);
    finish({ lastError: code });
  } finally {
    clearTimeout(limit);
  }
}

/**
 * Arm the hourly round at boot; it runs at once only when the last success is over an hour old.
 */
export function startGranolaRound(): void {
  schedule(nextRunDelay(polledAt(), new Date()));
}

/**
 * Clear the timer and stop a running round, for disable and shutdown.
 */
export async function stopGranolaRound(): Promise<void> {
  clearTimer();
  await abortRound();
}

/**
 * Analyze now: start a round unless the source is off or a round is running.
 */
export function runGranolaNow(): GranolaRunResult {
  if (!granolaSettings().enabled) return "disabled";
  if (current !== null) return "running";
  startRound();
  return "started";
}

/**
 * React to a settings write that already reached the held config.
 *
 * @remarks Applies run one at a time in arrival order, so two overlapping writes can never start a
 * round while the source is off or leave it on with no timer. A window change drops the cursor so
 * the next round reads the whole new window; disabling stops the timer and kills a running round.
 */
export function applyGranolaSettings(previous: {
  enabled: boolean;
  windowHours: number;
}): Promise<void> {
  const next = applying.then(async () => {
    const now = granolaSettings();
    const windowChanged = now.windowHours !== previous.windowHours;
    if (windowChanged) {
      await abortRound();
      await store.setSourceCursors("meeting", {});
    }
    if (!now.enabled) {
      await stopGranolaRound();
      return;
    }
    if (windowChanged) startRound();
    else if (!previous.enabled) {
      const delay = nextRunDelay(polledAt(), new Date());
      if (delay === 0) startRound();
      else schedule(delay);
    }
  });
  applying = next.catch(() => {});
  return next;
}

/**
 * Check connection: a fresh `claude mcp list`, with no model call.
 */
export async function checkGranolaConnection(): Promise<GranolaCheckResult> {
  const claude = await resolveBinaryPath("claude");
  if (claude === null) return { state: "claude-missing" };
  try {
    return await listGranola(claude);
  } catch {
    return { state: "failed" };
  }
}
