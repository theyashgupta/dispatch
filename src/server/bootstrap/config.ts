import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import type {
  Config,
  ItemSourceConfig,
  LinearStateMap,
  SlackSourceConfig,
  CalendarSourceConfig,
  MeetingSourceConfig,
  SourceFilters,
  StatusChannel,
  TerminalAppearance,
  UserProfile,
} from "../../shared/types.js";
import {
  CLAUDE_ACCOUNTS_BOUNDS,
  DEFAULT_CLAUDE_ARGS,
  DEFAULT_CLEANUP_DELAY_DAYS,
  DEFAULT_ARCHIVE_RETENTION_DAYS,
  ARCHIVE_RETENTION_MAX_DAYS,
  CALENDAR_TITLE_MAX,
  CALENDARS_MAX,
  DEFAULT_FILTERS,
  DEFAULT_GRANOLA_WINDOW_HOURS,
  DEFAULT_POLL_INTERVAL_MS,
  GRANOLA_WINDOW_HOURS,
} from "../../shared/types.js";
import {
  DEFAULT_TERMINAL_APPEARANCE,
  validateTerminalAppearance,
} from "../../shared/terminal-appearance.js";
import { parseProfile } from "../../shared/profile.js";
import { parseStateMap } from "../../shared/linear-state-map.js";
import { StartupError } from "./binary-check.js";
import {
  isSlackChannel,
  normalizeSlackChannels,
  SLACK_CHANNEL_MAX,
} from "../sources/slack/channel-ref.js";
import { CONFIG_PATH, DISPATCH_DIR } from "../services/infra/paths.js";

const DEFAULT_PORT = 4700;
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
  "// pollIntervalMs":
    "Default poll interval in ms for Linear and GitHub (Slack uses 120000 unless sources.slack.pollIntervalMs is set); sources.<id>.pollIntervalMs overrides it. Default 60000 (60s).",
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  "// workspaceRoot": "Root folder for per-ticket workspaces.",
  workspaceRoot: DEFAULT_WORKSPACE_ROOT,
  "// statusChannel":
    'Status source: "hooks", "pane", or "auto" (prefer hooks per session, pane fallback). Default "auto".',
  statusChannel: "auto",
  "// updateCheck":
    "Set to false to disable the on-boot update check. Default true.",
  updateCheck: true,
  "// linearSyncViaClaude":
    "Set to true to keep the old Claude MCP path for Sync to Linear for one release. Default false (direct GraphQL).",
  "// cleanupDelayDays":
    "Days a finished card keeps its workspace before automatic cleanup. 0 = clean up immediately on Done. Default 7, max 90.",
  cleanupDelayDays: DEFAULT_CLEANUP_DELAY_DAYS,
  "// archiveRetentionDays":
    "Days an unwound group stays in the archive before its worktrees are removed automatically. 0 = never. Default 30, max 365.",
  archiveRetentionDays: DEFAULT_ARCHIVE_RETENTION_DAYS,
  "// claudeArgs":
    "Extra CLI arguments passed to `claude` every time a session starts, resumes, or restarts. Leave empty for Claude's normal permission prompts.",
  claudeArgs: DEFAULT_CLAUDE_ARGS,
  "// terminal":
    "Terminal appearance (Settings > Terminal): background, foreground, cursor, fontFamily, fontSize (8 to 32). Remove the block to restore the defaults.",
  terminal: DEFAULT_TERMINAL_APPEARANCE,
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
 * Read a whole-days preference in `[0, max]`, tolerantly defaulting anything else to `fallback`
 * (`LIFE-04` posture: boot never blocks on a hand-edited value; the write routes are the strict side).
 */
function readWholeDays(
  parsed: Record<string, unknown>,
  key: "cleanupDelayDays" | "archiveRetentionDays",
  max: number,
  fallback: number,
): number {
  const value = parsed[key];
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= max
    ? value
    : fallback;
}

/** Read the About you profile tolerantly: a malformed or empty profile loads as absent. */
function readProfile(parsed: Record<string, unknown>): UserProfile | undefined {
  const result = parseProfile(parsed.profile);
  return result.ok && Object.keys(result.value).length > 0
    ? result.value
    : undefined;
}

/**
 * Read the `terminal` appearance block: absent, partial, or invalid resolves to the shipped
 * default, same tolerance posture as {@link readWholeDays}.
 */
function readTerminal(parsed: Record<string, unknown>): TerminalAppearance {
  const result = validateTerminalAppearance(parsed.terminal);
  return result.ok ? result.value : DEFAULT_TERMINAL_APPEARANCE;
}

/**
 * Read the `claudeArgs` preference: a plain string preference, absent or any non-string value
 * resolves to {@link DEFAULT_CLAUDE_ARGS}. Unlike {@link readWholeDays} there is no range
 * to reject — any string is a valid argv source once tokenized — so a present string is always
 * honored as-is, including an explicit `""` (no extra arguments), same posture as
 * {@link readLastUsedPlaybook} / {@link readUpdateCheck}.
 */
function readClaudeArgs(parsed: Record<string, unknown>): string {
  return typeof parsed.claudeArgs === "string"
    ? parsed.claudeArgs
    : DEFAULT_CLAUDE_ARGS;
}

/**
 * Read the `activeClaudeAccountId` pointer: a non-empty string is carried through verbatim, since
 * membership in the registry is checked at launch, not at boot; anything else resolves to absent
 * (the home login).
 */
function readActiveClaudeAccountId(
  parsed: Record<string, unknown>,
): string | undefined {
  return typeof parsed.activeClaudeAccountId === "string" &&
    parsed.activeClaudeAccountId.trim() !== ""
    ? parsed.activeClaudeAccountId
    : undefined;
}

/**
 * Read the `claudeAccounts` settings block, keeping only keys of the right type.
 *
 * @remarks An absent or wrong-typed key is left out, so it resolves to its default at read time.
 * A number out of range is clamped to the bounds the settings route enforces.
 */
function readClaudeAccounts(
  parsed: Record<string, unknown>,
): Config["claudeAccounts"] {
  const raw = parsed.claudeAccounts;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const block = raw as Record<string, unknown>;
  const out: NonNullable<Config["claudeAccounts"]> = {};
  if (typeof block.autoMove === "boolean") out.autoMove = block.autoMove;
  for (const key of ["thresholdPercent", "minDwellMinutes"] as const) {
    const value = block[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const { min, max } = CLAUDE_ACCOUNTS_BOUNDS[key];
    out[key] = Math.min(max, Math.max(min, value));
  }
  return out;
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
 * Read the well-formed `sources.<id>` object from a parsed config.
 *
 * @remarks Returns undefined when `sources` or `sources.<id>` is absent, null, an array or not
 * an object, so each caller applies its own fallback.
 */
function nestedSource(
  parsed: Record<string, unknown>,
  id: string,
): Record<string, unknown> | undefined {
  const sources = parsed.sources;
  if (typeof sources !== "object" || sources === null || Array.isArray(sources))
    return undefined;
  const source = (sources as Record<string, unknown>)[id];
  if (typeof source !== "object" || source === null || Array.isArray(source))
    return undefined;
  return source as Record<string, unknown>;
}

/**
 * Read a non-empty `sources.linear.apiKey`, or "" when absent or blank.
 *
 * @remarks Checked FIRST during load so an already-migrated file is detected before the flat key,
 * which keeps the boot migration idempotent.
 */
function readNestedKey(parsed: Record<string, unknown>): string {
  const apiKey = nestedSource(parsed, "linear")?.apiKey;
  return typeof apiKey === "string" ? apiKey.trim() : "";
}

/**
 * Read a `sources.linear.filters` block, coerced to a well-formed SourceFilters.
 *
 * @remarks Returns DEFAULT_FILTERS whenever the block is absent or malformed, so a config that has
 * `apiKey` but no `filters` still yields the assigned-to-me pull.
 */
function readNestedFilters(parsed: Record<string, unknown>): SourceFilters {
  const filters = nestedSource(parsed, "linear")?.filters;
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
    includeActive: f.includeActive === true,
  };
}

/**
 * Read `sources.linear.stateMap` through parseStateMap.
 *
 * @remarks An invalid stored map is ignored with a warning, so the push falls back to the defaults.
 */
function readNestedStateMap(
  parsed: Record<string, unknown>,
): LinearStateMap | undefined {
  const raw = nestedSource(parsed, "linear")?.stateMap;
  if (raw === undefined) return undefined;
  const result = parseStateMap(raw);
  if (result.ok) return result.map;
  console.warn(`[config] ignoring sources.linear.stateMap: ${result.error}`);
  return undefined;
}

/**
 * Read the optional `enabled` and `pollIntervalMs` fields of `sources.<id>`.
 *
 * @remarks A non-boolean `enabled` and a non-positive or non-finite interval are dropped, so the
 * resolved config falls back to the source's default and the global interval.
 */
function readNestedSourceSettings(
  parsed: Record<string, unknown>,
  id: string,
): ItemSourceConfig {
  const source = nestedSource(parsed, id);
  if (!source) return {};
  const out: ItemSourceConfig = {};
  if (typeof source.enabled === "boolean") out.enabled = source.enabled;
  if (
    typeof source.pollIntervalMs === "number" &&
    Number.isFinite(source.pollIntervalMs) &&
    source.pollIntervalMs > 0
  )
    out.pollIntervalMs = source.pollIntervalMs;
  return out;
}

/**
 * Read `sources.slack`: the item-source settings plus the picked channels.
 *
 * @remarks config.json is user-edited, so a malformed channel entry is dropped and the list is cut at
 * the save route's cap instead of failing boot.
 */
function readSlackSettings(parsed: Record<string, unknown>): SlackSourceConfig {
  const settings: SlackSourceConfig = readNestedSourceSettings(parsed, "slack");
  const slack = nestedSource(parsed, "slack");
  if (slack?.mode === "mcp" || slack?.mode === "token") {
    settings.mode = slack.mode;
  }
  const minutes = slack?.mcpIntervalMinutes;
  if (typeof minutes === "number" && Number.isInteger(minutes) && minutes > 0) {
    settings.mcpIntervalMinutes = minutes;
  }
  const channels = slack?.channels;
  if (Array.isArray(channels)) {
    settings.channels = normalizeSlackChannels(
      channels.filter(isSlackChannel),
    ).slice(0, SLACK_CHANNEL_MAX);
  }
  return settings;
}

/**
 * Read `sources.meeting`, dropping a non-boolean `enabled` and an unlisted `windowHours`.
 */
function readMeetingSource(
  parsed: Record<string, unknown>,
): MeetingSourceConfig {
  const meeting = nestedSource(parsed, "meeting") ?? {};
  const windowHours = GRANOLA_WINDOW_HOURS.find(
    (hours) => hours === meeting.windowHours,
  );
  return {
    ...(typeof meeting.enabled === "boolean"
      ? { enabled: meeting.enabled }
      : {}),
    windowHours: windowHours ?? DEFAULT_GRANOLA_WINDOW_HOURS,
  };
}

/**
 * Read `sources.calendar`, keeping at most 50 calendar titles of at most 200 characters.
 *
 * @remarks An unknown mode reads as macos, so a hand-edited typo never switches the source to the
 * iCal path, which needs a Vault key the user may not have.
 */
function readCalendarSource(
  parsed: Record<string, unknown>,
): CalendarSourceConfig {
  const calendar = nestedSource(parsed, "calendar") ?? {};
  const interval = calendar.pollIntervalMs;
  const titles = Array.isArray(calendar.calendars)
    ? calendar.calendars
        .filter(
          (title): title is string =>
            typeof title === "string" &&
            title.trim() !== "" &&
            title.length <= CALENDAR_TITLE_MAX,
        )
        .slice(0, CALENDARS_MAX)
    : undefined;
  return {
    ...(typeof calendar.enabled === "boolean"
      ? { enabled: calendar.enabled }
      : {}),
    ...(typeof interval === "number" &&
    Number.isFinite(interval) &&
    interval > 0
      ? { pollIntervalMs: interval }
      : {}),
    mode: calendar.mode === "ical" ? "ical" : "macos",
    ...(titles !== undefined ? { calendars: titles } : {}),
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
        `Dispatch will boot into first-run setup. Add your Linear API key in the browser.\n`,
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
        `[config] could not rewrite ${CONFIG_PATH} to the nested shape (${code}), continuing with the flat key.\n`,
      );
    }
  }

  const rawKey = nestedKey !== "" ? nestedKey : flatKey;

  if (parsed.repoPaths !== undefined || parsed.baseBranches !== undefined) {
    process.stderr.write(
      "[config] repoPaths is no longer used. Add a workspace folder from the start modal.\n",
    );
  }

  const workspaceRoot =
    typeof parsed.workspaceRoot === "string" &&
    parsed.workspaceRoot.trim() !== ""
      ? parsed.workspaceRoot.trim()
      : DEFAULT_WORKSPACE_ROOT;

  const activeClaudeAccountId = readActiveClaudeAccountId(parsed);
  const claudeAccounts = readClaudeAccounts(parsed);
  const stateMap = readNestedStateMap(parsed);
  const config: Config = {
    linearApiKey: rawKey,
    port: typeof parsed.port === "number" ? parsed.port : DEFAULT_PORT,
    pollIntervalMs:
      typeof parsed.pollIntervalMs === "number" &&
      Number.isFinite(parsed.pollIntervalMs) &&
      parsed.pollIntervalMs > 0
        ? parsed.pollIntervalMs
        : DEFAULT_POLL_INTERVAL_MS,
    workspaceRoot,
    statusChannel: readStatusChannel(parsed),
    updateCheck: readUpdateCheck(parsed),
    linearSyncViaClaude: parsed.linearSyncViaClaude === true,
    sources: {
      linear: {
        apiKey: rawKey,
        filters: readNestedFilters(parsed),
        ...readNestedSourceSettings(parsed, "linear"),
        ...(stateMap ? { stateMap } : {}),
      },
      github: readNestedSourceSettings(parsed, "github"),
      sentry: readNestedSourceSettings(parsed, "sentry"),
      slack: readSlackSettings(parsed),
      meeting: readMeetingSource(parsed),
      calendar: readCalendarSource(parsed),
    },
    lastUsedPlaybook: readLastUsedPlaybook(parsed),
    cleanupDelayDays: readWholeDays(
      parsed,
      "cleanupDelayDays",
      90,
      DEFAULT_CLEANUP_DELAY_DAYS,
    ),
    archiveRetentionDays: readWholeDays(
      parsed,
      "archiveRetentionDays",
      ARCHIVE_RETENTION_MAX_DAYS,
      DEFAULT_ARCHIVE_RETENTION_DAYS,
    ),
    claudeArgs: readClaudeArgs(parsed),
    ...(activeClaudeAccountId !== undefined ? { activeClaudeAccountId } : {}),
    ...(claudeAccounts ? { claudeAccounts } : {}),
    terminal: readTerminal(parsed),
  };
  const profile = readProfile(parsed);
  if (profile) config.profile = profile;
  if (parsed.onboardingDone === true) config.onboardingDone = true;

  const hasKey = config.linearApiKey.length > 0;
  console.log(`[config] loaded ${CONFIG_PATH} (api key present: ${hasKey})`);
  return config;
}
