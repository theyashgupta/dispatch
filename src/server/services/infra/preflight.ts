import { accessSync, constants, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  PreflightReport,
  PrerequisiteStatus,
} from "../../../shared/types.js";
import { run, runInherit } from "../../adapters/exec.js";
import {
  resolveBinaryPath,
  resolveWithPrefixes,
} from "../../adapters/resolve-binary.js";
import { probeStorageHealth } from "../../store/board-db.js";

/** The four binaries Dispatch needs at runtime (spec + BOARD-05). */
export const REQUIRED_BINARIES = ["tmux", "ttyd", "git", "claude"] as const;

/** Package-manager-installable targets that get the run-on-confirm flow; `claude` is print-only. */
const INSTALLABLE_BINARIES = new Set(["tmux", "ttyd", "git"]);

/** Print-only guidance for `claude`, which is never package-manager-installed. */
const CLAUDE_HINT = "install Claude Code — https://docs.claude.com/claude-code";

/** Fallback guidance for an installable binary when no package manager is detected. */
const GENERIC_HINTS: Record<string, string> = {
  tmux: "install tmux via your platform's package manager or build from source",
  ttyd: "install ttyd — https://github.com/tsl0922/ttyd/releases",
  git: "install git — https://git-scm.com/downloads",
};

/** Linux package managers probed in fixed priority order. */
const LINUX_MANAGERS = ["apt-get", "dnf", "pacman", "zypper", "apk"] as const;

/** The install verb (argv fragment) each Linux manager uses before the package name. */
const LINUX_INSTALL_VERB: Record<string, string[]> = {
  "apt-get": ["install"],
  dnf: ["install"],
  pacman: ["-S"],
  zypper: ["install"],
  apk: ["add"],
};

/** The exact install command to run for a target: human-readable `display` plus its spawn argv. */
export interface InstallCommand {
  display: string;
  cmd: string;
  args: string[];
}

/**
 * Synchronously test whether `name` is an executable anywhere on the process PATH — a `which`
 * equivalent used to detect a (stable, pre-existing) package manager while {@link installArgv}
 * stays synchronous.
 */
function onPathSync(name: string): boolean {
  const dirs = (process.env.PATH ?? "").split(delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch {}
  }
  return false;
}

/** Map `process.platform` to the coarse platform family the install resolver branches on. */
function detectPlatform(): "darwin" | "linux" | "other" {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  return "other";
}

/** Detect the platform's package manager: `brew` on macOS, else the first present Linux manager. */
function detectPackageManager(os: "darwin" | "linux" | "other"): string | null {
  if (os === "darwin") return "brew";
  if (os === "linux") {
    for (const mgr of LINUX_MANAGERS) {
      if (onPathSync(mgr)) return mgr;
    }
  }
  return null;
}

/**
 * Resolve the exact install command (display string + spawn argv) for an installable target, or
 * null for `claude`, an unknown name, or a platform with no detected package manager.
 * @remarks The argv is assembled entirely from server-side constants keyed by the detected package
 * manager and the whitelisted target — request input never reaches the argv. The spawn argv is an
 * array, never a shell string, and never a privilege-escalation prefix. On macOS `git` displays the
 * Xcode CLT hint but the SPAWNED argv stays package-manager-based, never the interactive Xcode GUI
 * installer.
 */
export function installArgv(target: string): InstallCommand | null {
  if (!INSTALLABLE_BINARIES.has(target)) return null;
  const manager = detectPackageManager(detectPlatform());
  if (manager === "brew") {
    if (target === "git") {
      return {
        display: "xcode-select --install  (or: brew install git)",
        cmd: "brew",
        args: ["install", "git"],
      };
    }
    return {
      display: `brew install ${target}`,
      cmd: "brew",
      args: ["install", target],
    };
  }
  const verb = manager ? LINUX_INSTALL_VERB[manager] : undefined;
  if (manager && verb) {
    const args = [...verb, target];
    return { display: `${manager} ${args.join(" ")}`, cmd: manager, args };
  }
  return null;
}

/** Build the shared status shape for one binary given its presence, sourcing `command` from installArgv. */
function statusFor(name: string, present: boolean): PrerequisiteStatus {
  if (name === "claude") {
    return {
      name,
      present,
      hint: present ? null : CLAUDE_HINT,
      installable: false,
      command: null,
    };
  }
  const argv = installArgv(name);
  const command = argv ? argv.display : (GENERIC_HINTS[name] ?? null);
  return {
    name,
    present,
    hint: present ? null : command,
    installable: true,
    command: present ? null : command,
  };
}

/**
 * Read the supported Node floor (`engines.node`, e.g. `>=22.22`) from the nearest ancestor
 * package.json, mirroring cli.ts `readVersion()`'s walk-up so it resolves in both `dist/` and `src/`.
 */
function readNodeFloor(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8"),
      ) as {
        name?: string;
        engines?: { node?: string };
      };
      if (pkg.name) return pkg.engines?.node ?? ">=0.0";
    } catch {}
    dir = dirname(dir);
  }
  return ">=0.0";
}

/**
 * Is the running Node at or above the floor, compared by `major.minor` integers?
 * @remarks INFORMATIVE only (PRE-01) — the caller renders a line and never branches execution on it.
 * The floor is minor-level (`>=22.22`) so patch/pre-release granularity is unnecessary.
 */
function nodeOk(current: string, floor: string): boolean {
  const [cMaj, cMin] = current.split(".").map(Number);
  const m = floor.match(/(\d+)\.(\d+)/);
  if (!m) return true;
  const fMaj = Number(m[1]);
  const fMin = Number(m[2]);
  return cMaj > fMaj || (cMaj === fMaj && cMin >= fMin);
}

/**
 * The single source of truth for prerequisite / Node-version / storage-health status and the
 * detected platform + package manager, consumed identically by `dispatch doctor`, ordinary boot,
 * and the web first-run setup screen. Every field is INFORMATIVE (PRE-01/02/03) — nothing here
 * blocks boot.
 * @remarks Presence is read PATH-only via `resolveBinaryPath` (the post-install re-probe unions the
 * known prefixes in {@link runInstall}); storage is read read-only via `probeStorageHealth` and is
 * never quarantined.
 */
export async function probePreflight(): Promise<PreflightReport> {
  const os = detectPlatform();
  const packageManager = detectPackageManager(os);
  const binaries = await Promise.all(
    REQUIRED_BINARIES.map(async (name) =>
      statusFor(name, (await resolveBinaryPath(name)) != null),
    ),
  );
  const version = process.versions.node;
  const floor = readNodeFloor();
  return {
    binaries,
    node: { version, floor, ok: nodeOk(version, floor) },
    storage: probeStorageHealth(),
    platform: { os, packageManager },
  };
}

/**
 * Lazy, feature-scoped `cloudflared` presence check — deliberately NOT part of
 * {@link REQUIRED_BINARIES}/`probePreflight()` (TUNNEL-03): appending it there would nag every
 * user who never opens Settings' Remote tab. Called only from the tunnel enable path. Treated like
 * the `claude` special-case (`installable: false`, print-only) rather than routed through
 * `installArgv`/`INSTALLABLE_BINARIES` — most Linux distros don't carry `cloudflared` in their
 * default package-manager repos, so a generic `apt-get install cloudflared` button would fail
 * silently.
 */
export async function checkCloudflaredPresence(): Promise<PrerequisiteStatus> {
  const present = (await resolveBinaryPath("cloudflared")) != null;
  return {
    name: "cloudflared",
    present,
    hint: present ? null : "brew install cloudflared",
    installable: false,
    command: null,
  };
}

/** Re-probe a binary's status after an install attempt, unioning known install prefixes (INST-04). */
async function reprobeStatus(target: string): Promise<PrerequisiteStatus> {
  return statusFor(target, (await resolveWithPrefixes(target)) != null);
}

/**
 * Run the install for `target` and return the RE-PROBED status. Interactive callers (`dispatch
 * doctor` in a TTY) stream output via `spawn` `stdio:"inherit"`; the web/non-interactive path
 * captures via `exec.ts` `run()` with no streaming (the locked request/response contract).
 * @remarks A non-installable/unknown target (including `claude`) returns `{ ok:false, command:"" }`
 * with the freshly re-probed status, so a bad target can never spawn anything. After the attempt —
 * success OR failure — presence is re-checked with `resolveWithPrefixes`, not the stale process
 * PATH (INST-04), so a good install does not read "still missing". A failure is non-blocking: the
 * caller reports it and continues (PRE-03).
 */
export async function runInstall(
  target: string,
  opts: { interactive: boolean },
): Promise<{ ok: boolean; command: string; status: PrerequisiteStatus }> {
  const argv = installArgv(target);
  if (!argv) {
    return { ok: false, command: "", status: await reprobeStatus(target) };
  }
  let ok: boolean;
  if (opts.interactive) {
    ok = (await runInherit(argv.cmd, argv.args)) === 0;
  } else {
    try {
      await run(argv.cmd, argv.args);
      ok = true;
    } catch {
      ok = false;
    }
  }
  return { ok, command: argv.display, status: await reprobeStatus(target) };
}
