import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * Resolve the absolute path of `bin` on PATH (via `which`), or null if not found.
 * The orchestrator passes the resolved absolute `claude` path to tmux, immunizing the
 * session against tmux-server env/PATH drift. Never rejects.
 */
export async function resolveBinaryPath(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP("which", [bin], { encoding: "utf8" });
    const resolved = stdout.trim();
    return resolved.length > 0 ? resolved : null;
  } catch {
    return null;
  }
}
