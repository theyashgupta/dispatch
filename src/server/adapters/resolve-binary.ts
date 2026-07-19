import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { run } from "./exec.js";

/**
 * Resolve the absolute path of `bin` on PATH (via `which`), or null if not found.
 * The orchestrator passes the resolved absolute `claude` path to tmux, immunizing the
 * session against tmux-server env/PATH drift. Never rejects.
 */
export async function resolveBinaryPath(bin: string): Promise<string | null> {
  try {
    const { stdout } = await run("which", [bin]);
    const resolved = stdout.trim();
    return resolved.length > 0 ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * Absolute install prefixes probed by {@link resolveWithPrefixes} after an install, keyed by
 * platform. Apple-Silicon Homebrew lands in `/opt/homebrew/bin`, Intel in `/usr/local/bin`, Xcode
 * git in `/usr/bin`; Linux managers land in `/usr/bin`/`/usr/local/bin`, linuxbrew under
 * `/home/linuxbrew/.linuxbrew/bin`, and pip/user installs in `~/.local/bin`.
 */
const KNOWN_PREFIXES: Record<"darwin" | "linux", string[]> = {
  darwin: ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"],
  linux: [
    "/usr/bin",
    "/usr/local/bin",
    "/home/linuxbrew/.linuxbrew/bin",
    join(homedir(), ".local/bin"),
  ],
};

/**
 * Resolve `name` first on the live PATH, then against known absolute install prefixes.
 * @remarks INST-04: `process.env.PATH` is snapshotted at launch, so a binary just installed into
 * `/opt/homebrew/bin` (etc.) is invisible to `which` in the running process — a good install would
 * otherwise re-check as "still missing". Kept SEPARATE from {@link resolveBinaryPath} (which stays
 * PATH-only) so the orchestrator's session-launch resolution is unaffected; only the post-install
 * re-probe unions the prefixes.
 */
export async function resolveWithPrefixes(
  name: string,
): Promise<string | null> {
  const onPath = await resolveBinaryPath(name);
  if (onPath != null) return onPath;
  const platform = process.platform === "darwin" ? "darwin" : "linux";
  for (const prefix of KNOWN_PREFIXES[platform]) {
    const candidate = join(prefix, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}
