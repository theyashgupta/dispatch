import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Run an argv command and capture stdout/stderr.
 * On non-zero exit / spawn failure, throws an Error carrying `.stderr` and `.stdout`
 * (both always strings) so callers can surface the underlying git/tmux stderr on the card.
 * @remarks Uses the Node built-in `execFile`, NOT execa — execa is not installed and none is
 * added (NEW-11). The promisified `execFile` rejects with `.stderr`/`.stdout` populated on Node
 * 22, and that captured stderr IS the card's error payload; swapping in a library whose rejection
 * omits `.stderr` would silently blank every card error (ORCH-02/04).
 * @see docs/ARCHITECTURE.md#exec-chokepoint
 */
export async function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number; maxBuffer?: number } = {},
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, {
      ...opts,
      encoding: "utf8",
    });
    return { stdout, stderr };
  } catch (err) {
    const e = err as Error & { stderr?: string; stdout?: string };
    throw Object.assign(new Error(e.message), {
      stderr: e.stderr ?? "",
      stdout: e.stdout ?? "",
    });
  }
}

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
