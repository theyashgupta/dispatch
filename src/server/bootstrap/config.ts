import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import type {
  Config,
  SourceFilters,
  StatusChannel,
} from "../../shared/types.js";
import { DEFAULT_FILTERS } from "../../shared/types.js";
import { StartupError } from "./binary-check.js";
import { CONFIG_PATH, DISPATCH_DIR } from "../services/paths.js";

const DEFAULT_PORT = 4700;
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), "dispatch-workspaces");

/**
 * First-run template. Uses "//" keys as inline documentation (valid JSON, ignored on load)
 * so a user can read the guidance and still have the file parse cleanly after editing.
 */
const CONFIG_TEMPLATE = {
  "//": "Dispatch config. Add your Linear API key in the browser first-run setup (or here). This file is kept at mode 0600 (owner read/write only).",
  "// linearApiKey":
    "Required. Linear personal API key: Linear -> Settings -> Security & access -> Personal API keys -> New key.",
  linearApiKey: "",
  "// port": "Backend HTTP port (loopback only). Default 4700.",
  port: DEFAULT_PORT,
  "// pollIntervalMs": "Linear poll interval in ms. Default 60000 (60s).",
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  "// workspaceRoot": "Phase 2+. Root folder for per-ticket workspaces.",
  workspaceRoot: DEFAULT_WORKSPACE_ROOT,
  "// statusChannel":
    'Status source: "hooks", "pane", or "auto" (prefer hooks per session, pane fallback). Default "auto".',
  statusChannel: "auto",
  "// updateCheck":
    "Set to false to disable the on-boot update check. Default true.",
  updateCheck: true,
};

/**
 * Validate the `statusChannel` key: absent resolves to `"auto"`; a present value that is not
 * exactly one of the three literals throws StartupError naming the field and the allowed values
 * (approved validation contract — a hand-edited enum typo must fail loudly, not silently default).
 */
function readStatusChannel(parsed: Record<string, unknown>): StatusChannel {
  const value = parsed.statusChannel;
  if (value === undefined) return "auto";
  if (value === "hooks" || value === "pane" || value === "auto") return value;
  throw new StartupError(
    `statusChannel in ${CONFIG_PATH} must be one of "hooks", "pane", "auto". Fix it and restart.`,
  );
}

/**
 * Read the `updateCheck` opt-out: absent or any non-`false` value resolves to `true`.
 * @remarks Deliberately does NOT throw `StartupError` the way {@link readStatusChannel} does for an
 * invalid enum literal — `updateCheck` is a plain boolean preference, not a closed set of routing
 * literals, so a malformed/truthy-but-wrong value safely coerces to the default-on behavior rather
 * than blocking boot; only an explicit `false` disables the check.
 */
function readUpdateCheck(parsed: Record<string, unknown>): boolean {
  return parsed.updateCheck === false ? false : true;
}

/**
 * Read the remembered kickoff-picker default: a plain string preference, absent or any
 * non-string value resolves to `undefined` (no `StartupError` — mirrors {@link readUpdateCheck},
 * never a closed enum like `statusChannel`). A name that no longer resolves to a valid playbook
 * is not caught here — the picker's fallback cascade handles that at read time.
 */
function readLastUsedPlaybook(
  parsed: Record<string, unknown>,
): string | undefined {
  return typeof parsed.lastUsedPlaybook === "string"
    ? parsed.lastUsedPlaybook
    : undefined;
}

/**
 * Read a non-empty `sources.linear.apiKey` from a parsed config object, or "" when the nested shape is
 * absent or blank. Checked FIRST during load so an already-migrated file is detected before the flat
 * key, which is what keeps the boot migration idempotent — a second boot never re-wraps an existing
 * `sources` block into `sources.linear.sources.linear`.
 */
function readNestedKey(parsed: Record<string, unknown>): string {
  const sources = parsed.sources;
  if (
    typeof sources !== "object" ||
    sources === null ||
    Array.isArray(sources)
  ) {
    return "";
  }
  const linear = (sources as Record<string, unknown>).linear;
  if (typeof linear !== "object" || linear === null || Array.isArray(linear)) {
    return "";
  }
  const apiKey = (linear as Record<string, unknown>).apiKey;
  return typeof apiKey === "string" ? apiKey.trim() : "";
}

/**
 * Read a `sources.linear.filters` block from a parsed config, coercing to the well-formed
 * SourceFilters shape (string arrays + boolean). Returns DEFAULT_FILTERS whenever the block is
 * absent or malformed, so a Phase-22-migrated config that has `apiKey` but no `filters` still yields
 * today's assigned-to-me pull (Pitfall P6 / FILT-05). Idempotent: a config already carrying a valid
 * block is echoed back unchanged.
 */
function readNestedFilters(parsed: Record<string, unknown>): SourceFilters {
  const sources = parsed.sources;
  if (typeof sources !== "object" || sources === null || Array.isArray(sources))
    return DEFAULT_FILTERS;
  const linear = (sources as Record<string, unknown>).linear;
  if (typeof linear !== "object" || linear === null || Array.isArray(linear))
    return DEFAULT_FILTERS;
  const filters = (linear as Record<string, unknown>).filters;
  if (typeof filters !== "object" || filters === null || Array.isArray(filters))
    return DEFAULT_FILTERS;
  const f = filters as Record<string, unknown>;
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    assignees: strArray(f.assignees),
    projects: strArray(f.projects),
    teams: strArray(f.teams),
    currentCycle: f.currentCycle === true,
  };
}

/**
 * Build the nested-shape object for the flat→nested boot migration. config.json is a user-edited
 * file, so unknown top-level keys are expected and carried forward verbatim, and any pre-existing
 * `sources` entries are preserved — including keys already inside `sources.linear` (a `filters`
 * block written against a still-flat file must survive re-migration, not silently reset the board
 * scope); the migration only rewrites what it owns — the flat `linearApiKey` becomes
 * `sources.linear.apiKey`, and the retired `repoPaths`/`baseBranches` keys plus the first-run
 * template's "//" doc keys (guidance written for the pre-migration shape) are dropped deliberately.
 */
function buildMigratedConfig(
  parsed: Record<string, unknown>,
  flatKey: string,
): Record<string, unknown> {
  const retired = new Set(["linearApiKey", "repoPaths", "baseBranches"]);
  const migrated: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (retired.has(key) || key.startsWith("//")) continue;
    migrated[key] = value;
  }
  const priorSources =
    typeof parsed.sources === "object" &&
    parsed.sources !== null &&
    !Array.isArray(parsed.sources)
      ? (parsed.sources as Record<string, unknown>)
      : {};
  const priorLinear =
    typeof priorSources.linear === "object" &&
    priorSources.linear !== null &&
    !Array.isArray(priorSources.linear)
      ? (priorSources.linear as Record<string, unknown>)
      : {};
  migrated.sources = {
    ...priorSources,
    linear: { ...priorLinear, apiKey: flatKey },
  };
  return migrated;
}

/**
 * Load and validate the config, or bootstrap it into a needs-setup state.
 * - Missing file: create the dir (0o700), write the 0o600 template, print guidance, then fall
 *   through to parse it so an empty key boots into first-run setup rather than exiting.
 * - Existing file: parse, apply defaults for port/pollIntervalMs, tighten perms to 0o600. An empty
 *   key is a bootable needs-setup signal (linearApiKey ""), NOT a fatal error; retired
 *   repoPaths/baseBranches keys are ignored with a one-line notice when still present on disk.
 * The API key value is never logged (presence is logged as a boolean only) — JSON parse failures
 * report the error position but never the parser message, because V8 embeds a snippet of the input
 * around the failure point and a mis-quoted key sits exactly there.
 */
export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.mkdirSync(DISPATCH_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify(CONFIG_TEMPLATE, null, 2) + "\n",
      { mode: 0o600 },
    );
    fs.chmodSync(CONFIG_PATH, 0o600);
    process.stderr.write(
      `No config found. Wrote a template to ${CONFIG_PATH}.\n` +
        `Dispatch will boot into first-run setup — add your Linear API key in the browser.\n`,
    );
  }

  try {
    const st = fs.statSync(CONFIG_PATH);
    if ((st.mode & 0o077) !== 0) {
      fs.chmodSync(CONFIG_PATH, 0o600);
    }
  } catch {}

  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch (err) {
    throw new StartupError(
      `Could not read config at ${CONFIG_PATH}: ${(err as Error).message}`,
    );
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(raw);
  } catch (err) {
    const pos = /position (\d+)/.exec((err as Error).message)?.[1];
    throw new StartupError(
      `Config at ${CONFIG_PATH} is not valid JSON${pos ? ` (near position ${pos})` : ""}. Fix it and restart.`,
    );
  }
  if (
    typeof parsedUnknown !== "object" ||
    parsedUnknown === null ||
    Array.isArray(parsedUnknown)
  ) {
    throw new StartupError(
      `Config at ${CONFIG_PATH} must be a JSON object. Fix it and restart.`,
    );
  }
  const parsed = parsedUnknown as Record<string, unknown>;

  const nestedKey = readNestedKey(parsed);
  const flatKey =
    typeof parsed.linearApiKey === "string" ? parsed.linearApiKey.trim() : "";

  if (nestedKey === "" && flatKey !== "") {
    const migrated = buildMigratedConfig(parsed, flatKey);
    try {
      writeFileAtomic.sync(
        CONFIG_PATH,
        JSON.stringify(migrated, null, 2) + "\n",
        {
          mode: 0o600,
        },
      );
      fs.chmodSync(CONFIG_PATH, 0o600);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "write failed";
      process.stderr.write(
        `[config] could not rewrite ${CONFIG_PATH} to the nested shape (${code}) — continuing with the flat key.\n`,
      );
    }
  }

  const rawKey = nestedKey !== "" ? nestedKey : flatKey;

  if (parsed.repoPaths !== undefined || parsed.baseBranches !== undefined) {
    process.stderr.write(
      "[config] repoPaths is no longer used — add a workspace folder from the start modal.\n",
    );
  }

  const workspaceRoot =
    typeof parsed.workspaceRoot === "string" &&
    parsed.workspaceRoot.trim() !== ""
      ? parsed.workspaceRoot.trim()
      : DEFAULT_WORKSPACE_ROOT;

  const config: Config = {
    linearApiKey: rawKey,
    port: typeof parsed.port === "number" ? parsed.port : DEFAULT_PORT,
    pollIntervalMs:
      typeof parsed.pollIntervalMs === "number"
        ? parsed.pollIntervalMs
        : DEFAULT_POLL_INTERVAL_MS,
    workspaceRoot,
    statusChannel: readStatusChannel(parsed),
    updateCheck: readUpdateCheck(parsed),
    sources: { linear: { apiKey: rawKey, filters: readNestedFilters(parsed) } },
    lastUsedPlaybook: readLastUsedPlaybook(parsed),
  };

  const hasKey = config.linearApiKey.length > 0;
  console.log(`[config] loaded ${CONFIG_PATH} (api key present: ${hasKey})`);
  return config;
}
