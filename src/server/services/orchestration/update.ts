import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import writeFileAtomic from "write-file-atomic";
import type {
  Config,
  UpdateRunResult,
  UpdateStatus,
} from "../../../shared/types.js";
import { run } from "../../adapters/exec.js";
import { DISPATCH_DIR, UPDATE_CACHE_PATH } from "../infra/paths.js";

const REGISTRY_URL =
  "https://registry.npmjs.org/@theyashgupta%2fdispatch/latest";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface UpdateCache {
  lastCheckedAt: string;
  latestSeen: string | null;
}

/**
 * Read the package version from the nearest ancestor package.json, mirroring cli.ts
 * `readVersion()`'s walk-up so this service resolves in both `dist/` and `src/`.
 */
function readCurrentVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8"),
      ) as { name?: string; version?: string };
      if (pkg.name) return pkg.version ?? "0.0.0";
    } catch {}
    dir = dirname(dir);
  }
  return "0.0.0";
}

/**
 * Detect whether this running copy of dispatch was installed globally, via npx, or from a local
 * checkout, from the module's OWN resolved path.
 * @remarks Uses `fileURLToPath(import.meta.url)`, never `process.argv[1]` — the latter reflects the
 * unresolved npm bin symlink, not the real on-disk location. Checks are substring (`.includes()`),
 * never a prefix check: an nvm global root (e.g. `~/.nvm/versions/node/vX/lib/node_modules`) is not
 * filesystem-root-anchored, so a prefix check would misclassify every nvm user as "local".
 */
export function detectInstallMode(): "global" | "npx" | "local" {
  const entry = fileURLToPath(import.meta.url);
  if (entry.includes(`${sep}_npx${sep}`)) return "npx";
  if (entry.includes(`${sep}lib${sep}node_modules${sep}`)) return "global";
  return "local";
}

/**
 * Fetch the registry's current `latest` version. Every failure — offline, timeout, non-2xx,
 * non-JSON — degrades identically to `null`; this function never throws.
 */
async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(REGISTRY_URL, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Compare two `major.minor.patch` version strings numerically, segment by segment. Never a
 * lexicographic string compare — `"1.10.0" > "1.9.0"` is false as strings but true numerically.
 */
function compareVersions(a: string, b: string): number {
  const as = a.split(".").map((n) => Number(n) || 0);
  const bs = b.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (as[i] ?? 0) - (bs[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Read the update-check cache. A corrupt or missing file is not an error — just re-check. */
function readCache(): UpdateCache | null {
  try {
    const raw = readFileSync(UPDATE_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<UpdateCache>;
    if (typeof parsed.lastCheckedAt !== "string") return null;
    return {
      lastCheckedAt: parsed.lastCheckedAt,
      latestSeen:
        typeof parsed.latestSeen === "string" ? parsed.latestSeen : null,
    };
  } catch {
    return null;
  }
}

/** Write the update-check cache atomically. A failed write is swallowed — caching is best-effort. */
async function writeCache(cache: UpdateCache): Promise<void> {
  try {
    mkdirSync(DISPATCH_DIR, { recursive: true });
    await writeFileAtomic(UPDATE_CACHE_PATH, JSON.stringify(cache));
  } catch {}
}

function isCacheFresh(cache: UpdateCache): boolean {
  const age = Date.now() - new Date(cache.lastCheckedAt).getTime();
  return Number.isFinite(age) && age < CHECK_INTERVAL_MS;
}

/**
 * The single source of truth for update status, consumed identically by `dispatch update`,
 * `dispatch doctor`, the boot-time check loop, and the web update banner.
 * @remarks NEVER throws — every sub-check (registry fetch, cache read/write) degrades silently, so
 * a `liveCheck` caller always gets a usable status even fully offline. `liveCheck: false` reuses a
 * fresh (<24h) cached `latestSeen` instead of hitting the network, capping anonymous registry
 * traffic at one GET/day; `dispatch update`/`dispatch doctor` always pass `liveCheck: true`.
 */
export async function checkForUpdate(opts: {
  liveCheck: boolean;
}): Promise<UpdateStatus> {
  const current = readCurrentVersion();
  const installMode = detectInstallMode();

  let latest: string | null = null;
  try {
    const cache = readCache();
    if (!opts.liveCheck && cache && isCacheFresh(cache)) {
      latest = cache.latestSeen;
    } else {
      latest = await fetchLatestVersion();
      if (latest != null) {
        await writeCache({
          lastCheckedAt: new Date().toISOString(),
          latestSeen: latest,
        });
      }
    }
  } catch {
    latest = null;
  }

  const updateAvailable =
    latest != null && compareVersions(current, latest) < 0;
  return { updateAvailable, current, latest, installMode };
}

/** Spawn an argv command inheriting the terminal so npm output streams live; resolve its exit code. */
function spawnInherit(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", () => resolve(-1));
    child.on("exit", (code) => resolve(code ?? -1));
  });
}

/**
 * Confirm the post-update version by asking npm directly (`npm root -g`), never by re-reading the
 * running process's own resolved path.
 * @remarks The running process's module graph is fixed at start — re-deriving a path from
 * `import.meta.url` after `npm i -g` mutates files on disk would still resolve relative to the OLD
 * install location. Asking npm for its CURRENT global root and reading that package.json directly
 * sidesteps the entire stale-resolution class of bug.
 */
async function confirmInstalledVersion(): Promise<string | null> {
  try {
    const { stdout } = await run("npm", ["root", "-g"]);
    const root = stdout.trim();
    const pkgPath = join(root, "@theyashgupta", "dispatch", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: string;
    };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

let inFlight: Promise<UpdateRunResult> | null = null;

/**
 * Run the global-mode update. The argv is a 100% constant literal — never built from any input,
 * never `sudo`, never a shell string. `interactive` callers (a real TTY) stream via `spawn`
 * `stdio:"inherit"`; non-interactive callers (the web route) capture via `adapters/exec.ts` `run()`.
 * @remarks Serializes on a module-level in-flight promise so two concurrent callers (a second
 * browser tab, a reload mid-update, a direct loopback `curl`) never launch parallel `npm i -g`
 * installs of the same package — the second caller just awaits the first's result.
 */
export function runUpdate(opts: {
  interactive: boolean;
}): Promise<UpdateRunResult> {
  if (inFlight) return inFlight;
  inFlight = doRunUpdate(opts).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Perform the actual global-mode update; wrapped by {@link runUpdate}'s in-flight guard. */
async function doRunUpdate(opts: {
  interactive: boolean;
}): Promise<UpdateRunResult> {
  const cmd = "npm";
  const args = ["i", "-g", "@theyashgupta/dispatch@latest"];
  let ok: boolean;
  if (opts.interactive) {
    ok = (await spawnInherit(cmd, args)) === 0;
  } else {
    try {
      await run(cmd, args, {
        timeout: 5 * 60_000,
        maxBuffer: 32 * 1024 * 1024,
      });
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    return { ok: false, command: "npm i -g @theyashgupta/dispatch@latest" };
  }
  const version = await confirmInstalledVersion();
  if (version == null) {
    return { ok: false, command: "npm i -g @theyashgupta/dispatch@latest" };
  }
  return { ok: true, version };
}

/**
 * Start the 24h self-rescheduling update-check loop. Runs one non-live check immediately (reusing
 * the cache when fresh), logs a single line when an update is available, then re-arms in 24h
 * regardless of success or failure. Fire-and-forget and non-blocking — never delays boot, never
 * holds the process open (`.unref()`).
 */
export function startUpdateCheckLoop(config: Config): void {
  void checkForUpdate({ liveCheck: false }).then((status) => {
    if (status.updateAvailable) {
      const command =
        status.installMode === "global"
          ? "npm i -g @theyashgupta/dispatch@latest"
          : status.installMode === "npx"
            ? "npx @theyashgupta/dispatch@latest"
            : "pull the latest changes (dev checkout)";
      console.log(
        `[update] dispatch ${status.latest} is available (current: ${status.current}) — ${command}`,
      );
    }
  });
  const timer = setTimeout(
    () => startUpdateCheckLoop(config),
    CHECK_INTERVAL_MS,
  );
  timer.unref?.();
}
