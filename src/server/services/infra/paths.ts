import os from "node:os";
import path from "node:path";

/**
 * Canonical `~/.dispatch` root — the single source of truth for on-disk config/playbook locations,
 * living in the services layer so both bootstrap (config.ts) and services (playbooks.ts) can import
 * it without either re-deriving `os.homedir()` or crossing the services→bootstrap boundary.
 */
export const DISPATCH_DIR = path.join(os.homedir(), ".dispatch");

/**
 * `config.json` location, homed in `services` so both the bootstrap loader and a future services-layer
 * writer can share it without either re-deriving the path or crossing the services→bootstrap boundary.
 * The config file lives directly under `DISPATCH_DIR`; callers that need the containing directory
 * (e.g. first-run mkdir) use `DISPATCH_DIR` itself rather than a duplicate alias export.
 */
export const CONFIG_PATH = path.join(DISPATCH_DIR, "config.json");

/**
 * The dispatch-owned hook script claude invokes on Stop/UserPromptSubmit. Absolute (derived from
 * `os.homedir()` via DISPATCH_DIR) because the generated settings JSON must never rely on shell
 * expansion of `~` or `$HOME`.
 */
export const HOOK_SCRIPT_PATH = path.join(DISPATCH_DIR, "hook.sh");

/**
 * The static per-session settings layer passed to claude via `--settings`. Lives beside the hook
 * script so both regenerate together at boot; never merged into `~/.claude/settings.json`.
 */
export const HOOK_SETTINGS_PATH = path.join(DISPATCH_DIR, "hook-settings.json");

/**
 * The update-check cache, holding `{ lastCheckedAt, latestSeen }` so at most one anonymous
 * registry GET/day is made. A corrupt or missing file is not an error — the service just re-checks.
 */
export const UPDATE_CACHE_PATH = path.join(DISPATCH_DIR, "update-check.json");

/**
 * The boot-regenerated, cmd+click-patched ttyd served index (see bootstrap/ttyd-index-setup.ts).
 * Absolute (derived from `os.homedir()` via DISPATCH_DIR) because ttyd's `-I` flag is passed a
 * literal path, and it lives beside the other `.dispatch` artifacts since it is regenerated every
 * boot from the installed ttyd binary rather than vendored — a stale copy would silently drift
 * from a `brew upgrade ttyd`, so absence (not staleness) is the only state spawnTtyd ever trusts.
 */
export const TTYD_INDEX_PATH = path.join(
  DISPATCH_DIR,
  "ttyd-index.patched.html",
);

/**
 * The launchd label shared by the generated plist, every `launchctl` target, and uninstall's
 * bootout — kept as one constant so the three never drift onto different label strings.
 */
export const SERVICE_LABEL = "com.dispatch.app";

/**
 * The per-user LaunchAgent plist path. Lives under `~/Library/LaunchAgents`, NOT `DISPATCH_DIR`,
 * because that is the fixed location launchd itself scans to discover per-user agents.
 */
export const SERVICE_PLIST_PATH = path.join(
  os.homedir(),
  "Library",
  "LaunchAgents",
  `${SERVICE_LABEL}.plist`,
);

/**
 * launchd `StandardOutPath`/`StandardErrorPath` sinks for the background service. Kept beside the
 * other `.dispatch` artifacts (not under LaunchAgents with the plist) and deliberately preserved by
 * uninstall — the plist is disposable, the logs are diagnostic history.
 */
export const SERVICE_LOG_PATH = path.join(DISPATCH_DIR, "service.log");
export const SERVICE_ERR_LOG_PATH = path.join(DISPATCH_DIR, "service.err.log");
