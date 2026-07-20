import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Env-gated measurement instrumentation for the perf-subproc harness (PERF-01b), dead on every
 * normal path: `perfExec` and `perfCalls` are the only two allocations that exist when
 * `DISPATCH_PERF_EXEC` is unset, and neither is read nor written anywhere else in {@link run}.
 * @remarks This is the sole subprocess chokepoint (NEW-11: execa was never installed), so wrapping
 * `run()` alone captures effectively all `git`/`tmux`/`ttyd` load system-wide without touching those
 * adapters individually.
 * @see docs/ARCHITECTURE.md#exec-chokepoint
 */
const perfExec = process.env.DISPATCH_PERF_EXEC === "1";
const perfCalls: { cmd: string; ms: number }[] = [];

/**
 * Arm SIGTERM→grace→SIGKILL escalation for one child: schedule a `SIGKILL` `graceMs` after each
 * event that makes `execFile` send its default `SIGTERM` (an `opts.signal` abort, or the
 * `opts.timeout` deadline), mirroring the perf-harness kill pattern (`scripts/perf-boot.mjs`).
 * Without this, a child that ignores SIGTERM keeps the promisified `execFile` promise pending
 * forever — a caller's single-flight guard then wedges until backend restart. Returns a disarm
 * callback the caller MUST run on settle so a normally-exiting child's PID is never re-signalled.
 */
function armKillEscalation(
  child: ChildProcess,
  opts: { timeout?: number; signal?: AbortSignal },
  graceMs: number,
): () => void {
  const timers: NodeJS.Timeout[] = [];
  const onAbort = (): void => {
    timers.push(setTimeout(() => child.kill("SIGKILL"), graceMs));
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  if (opts.timeout !== undefined) {
    timers.push(
      setTimeout(() => child.kill("SIGKILL"), opts.timeout + graceMs),
    );
  }
  return () => {
    opts.signal?.removeEventListener("abort", onAbort);
    for (const t of timers) clearTimeout(t);
  };
}

/**
 * Run an argv command and capture stdout/stderr.
 * On non-zero exit / spawn failure, throws an Error carrying `.stderr` and `.stdout`
 * (both always strings) so callers can surface the underlying git/tmux stderr on the card.
 * `killEscalationMs` (opt-in, inert when unset) arms {@link armKillEscalation} for callers whose
 * child may ignore the abort/timeout SIGTERM (headless `claude -p` drafts).
 * @remarks Uses the Node built-in `execFile`, NOT execa — execa is not installed and none is
 * added (NEW-11). The promisified `execFile` rejects with `.stderr`/`.stdout` populated on Node
 * 22, and that captured stderr IS the card's error payload; swapping in a library whose rejection
 * omits `.stderr` would silently blank every card error (ORCH-02/04).
 * @see docs/ARCHITECTURE.md#exec-chokepoint
 */
export async function run(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    timeout?: number;
    maxBuffer?: number;
    signal?: AbortSignal;
    killEscalationMs?: number;
  } = {},
): Promise<ExecResult> {
  const t0 = perfExec ? performance.now() : 0;
  const { killEscalationMs, ...execOpts } = opts;
  const pending = execFileP(cmd, args, { ...execOpts, encoding: "utf8" });
  const disarm =
    killEscalationMs === undefined
      ? null
      : armKillEscalation(pending.child, execOpts, killEscalationMs);
  try {
    const { stdout, stderr } = await pending;
    if (perfExec) perfCalls.push({ cmd, ms: performance.now() - t0 });
    return { stdout, stderr };
  } catch (err) {
    if (perfExec) perfCalls.push({ cmd, ms: performance.now() - t0 });
    const e = err as Error & { stderr?: string; stdout?: string };
    throw Object.assign(new Error(e.message), {
      stderr: e.stderr ?? "",
      stdout: e.stdout ?? "",
    });
  } finally {
    disarm?.();
  }
}

/**
 * Dump every {@link run} call recorded since boot to stderr as one `DISPATCH_PERF_EXEC_DUMP` JSON
 * line, then exit. Invoked only when `DISPATCH_PERF_EXEC=1` — the perf-subproc harness SIGTERMs the
 * sandboxed server it drove and reads this line back to build the per-cmd breakdown table.
 * @remarks Exits inside the write callback, not synchronously after it: the harness pipes stderr,
 * pipe writes are asynchronous on macOS/Linux, and a synchronous `process.exit(0)` can discard the
 * pending dump line — the harness would then misread a delivery race as dead instrumentation.
 */
function registerPerfExecDump(): void {
  process.on("SIGTERM", () => {
    const byCmd: Record<string, { count: number; ms: number }> = {};
    for (const c of perfCalls) {
      const entry = byCmd[c.cmd] ?? { count: 0, ms: 0 };
      entry.count += 1;
      entry.ms += c.ms;
      byCmd[c.cmd] = entry;
    }
    const total = perfCalls.reduce((sum, c) => sum + c.ms, 0);
    process.stderr.write(
      `DISPATCH_PERF_EXEC_DUMP ${JSON.stringify({ calls: perfCalls.length, total, byCmd })}\n`,
      () => process.exit(0),
    );
  });
}

if (perfExec) registerPerfExecDump();

/** Resolve after `ms` milliseconds. Used by Plan 03's readiness poll and paste settle. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run an argv command with the terminal inherited so interactive package-manager/npm output
 * streams live to the user, resolving the exit code instead of capturing stdout/stderr.
 * @remarks The stdio-inherit foreground-streaming counterpart to {@link run}'s capture-and-await
 * shape — used by `dispatch doctor` installs and interactive self-update, where the user needs to
 * see live output. Never rejects: resolves `-1` on spawn error, `code ?? -1` on exit.
 * @see docs/ARCHITECTURE.md#exec-chokepoint
 */
export function runInherit(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", () => resolve(-1));
    child.on("exit", (code) => resolve(code ?? -1));
  });
}
