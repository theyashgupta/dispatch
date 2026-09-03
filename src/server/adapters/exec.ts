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
 * adapters individually. `shape` bounds each record to `cmd` plus the first two args (`gh pr list`,
 * `git worktree`), enough to count an invocation kind and never enough to carry a branch name, a
 * repo path, or a token (T-98-05); `opts.cwd` is deliberately never recorded here.
 * @see docs/ARCHITECTURE.md#exec-chokepoint
 */
const perfExec = process.env.DISPATCH_PERF_EXEC === "1";
const perfCalls: { cmd: string; shape: string; ms: number }[] = [];

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
 * (both always strings) so callers can surface the underlying git/tmux stderr on the card, plus
 * `.code` — a NUMBER for a real exit status, a STRING for a spawn failure such as `ENOENT`. That
 * distinction is load-bearing for probes whose success path can still exit non-zero: `lsof` exits 1
 * with perfectly valid stdout when its `-p` list names a pid that has since died, so a caller must
 * be able to tell "exited 1, parse the stdout anyway" from "binary missing, give up".
 * `killEscalationMs` (opt-in, inert when unset) arms {@link armKillEscalation} for callers whose
 * child may ignore the abort/timeout SIGTERM (headless `claude -p` drafts). `env` adds variables on
 * top of the inherited process environment (a per-account `CLAUDE_CONFIG_DIR`), never replaces it.
 * @param input written to the child's stdin, which is then closed; for stream-json requests. The
 * stdin error event is swallowed because a child that exits before draining a large input raises
 * EPIPE outside the awaited promise, which would otherwise take the whole server down.
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
    env?: Record<string, string>;
    input?: string;
  } = {},
): Promise<ExecResult> {
  const t0 = perfExec ? performance.now() : 0;
  const shape = perfExec ? [cmd, ...args.slice(0, 2)].join(" ") : "";
  const { killEscalationMs, env, input, ...execOpts } = opts;
  const pending = execFileP(cmd, args, {
    ...execOpts,
    ...(env ? { env: { ...process.env, ...env } } : {}),
    encoding: "utf8",
  });
  if (input !== undefined) {
    pending.child.stdin?.on("error", () => {});
    pending.child.stdin?.end(input);
  }
  const disarm =
    killEscalationMs === undefined
      ? null
      : armKillEscalation(pending.child, execOpts, killEscalationMs);
  try {
    const { stdout, stderr } = await pending;
    if (perfExec) perfCalls.push({ cmd, shape, ms: performance.now() - t0 });
    return { stdout, stderr };
  } catch (err) {
    if (perfExec) perfCalls.push({ cmd, shape, ms: performance.now() - t0 });
    const e = err as Error & {
      stderr?: string;
      stdout?: string;
      code?: number | string;
    };
    throw Object.assign(new Error(e.message), {
      stderr: e.stderr ?? "",
      stdout: e.stdout ?? "",
      code: e.code,
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
      const entry = byCmd[c.shape] ?? { count: 0, ms: 0 };
      entry.count += 1;
      entry.ms += c.ms;
      byCmd[c.shape] = entry;
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

/**
 * Spawn a long-lived argv-only child with every stdio stream piped, for the one adapter that must
 * write to a child's stdin (the Claude login's pasted code). Same no-shell guarantee as {@link run};
 * the caller owns the lifetime.
 */
export function spawnPiped(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): ChildProcess {
  return spawn(cmd, args, {
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
