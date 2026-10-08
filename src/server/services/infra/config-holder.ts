import fs from "node:fs";
import writeFileAtomic from "write-file-atomic";
import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  DEFAULT_CLAUDE_ACCOUNTS_SETTINGS,
  type ClaudeAccountsSettings,
  type Config,
  type ItemSourceId,
  type LinearStateMap,
  type SourceConfig,
  type SlackChannel,
  type SlackMode,
  type SourceFilters,
  type StatusChannel,
  type TerminalAppearance,
  type UserProfile,
} from "../../../shared/types.js";
import { resolveSlackMode } from "../../../shared/slack-mode.js";
import { CONFIG_PATH } from "./paths.js";
import { resolveSlackToken } from "./slack-token.js";

/** The loaded config, pushed in once by index.ts at boot. null until set (route → 400 if unset). */
let orchestrationConfig: Config | null = null;

/** index.ts calls this with the loaded config right after loadConfig(), before listen(). */
export function setOrchestrationConfig(config: Config): void {
  orchestrationConfig = config;
}

/** The start route reads the loaded config through this (never calls loadConfig itself). */
export function getOrchestrationConfig(): Config | null {
  return orchestrationConfig;
}

/**
 * Hook-injection runtime pushed in by bootstrap at boot: whether the installed claude CLI meets
 * the verified hooks-contract floor, the RESOLVED listen port (never a hardcoded default) that
 * session env must carry so hook POSTs reach a non-default-port backend, and the resolved
 * statusChannel so services can gate injection and hook-event mutations per mode.
 */
export interface HooksRuntime {
  capable: boolean;
  port: number;
  statusChannel: StatusChannel;
}

/** The hooks runtime, pushed in once by bootstrap. null until set (readers treat as not capable). */
let hooksRuntime: HooksRuntime | null = null;

/** Bootstrap calls this after the capability check, before any session can launch. */
export function setHooksRuntime(rt: HooksRuntime): void {
  hooksRuntime = rt;
}

/** Session-launching services read the capability flag + resolved port through this. */
export function getHooksRuntime(): HooksRuntime | null {
  return hooksRuntime;
}

/**
 * Rewrite one `sources.linear` field in config.json and mirror it onto the held config.
 *
 * @remarks The write is atomic at mode 0600 because the file holds the Linear key at rest. A parse
 * failure reports the byte position only: the parser message quotes the file, key included.
 */
function writeLinearField<K extends keyof SourceConfig>(
  field: K,
  value: SourceConfig[K],
): void {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  let parsed: Record<string, unknown>;
  try {
    const p = JSON.parse(raw) as unknown;
    if (typeof p !== "object" || p === null || Array.isArray(p)) {
      throw new Error("not an object");
    }
    parsed = p as Record<string, unknown>;
  } catch (err) {
    const pos = /position (\d+)/.exec((err as Error).message)?.[1];
    throw new Error(
      `config at ${CONFIG_PATH} is not valid JSON${pos ? ` (near position ${pos})` : ""}`,
    );
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

  const next = {
    ...parsed,
    sources: { ...priorSources, linear: { ...priorLinear, [field]: value } },
  };

  writeFileAtomic.sync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", {
    mode: 0o600,
  });
  fs.chmodSync(CONFIG_PATH, 0o600);

  const held = orchestrationConfig?.sources?.linear;
  if (held) held[field] = value;
}

/** Persist a source's filter selection so the next poll uses it. */
export function updateSourceFilters(
  sourceId: string,
  filters: SourceFilters,
): void {
  if (sourceId !== "linear") {
    throw new Error(`unknown source: ${sourceId}`);
  }
  writeLinearField("filters", filters);
}

/** Persist the Linear column-to-state map so the next push uses it. */
export function updateLinearStateMap(stateMap: LinearStateMap): void {
  writeLinearField("stateMap", stateMap);
}

/**
 * Persist the Linear API key so the next poll uses it.
 *
 * @remarks The setup route calls this only after a live Linear check passed, so a rejected key
 * never reaches disk.
 */
export function updateLinearApiKey(apiKey: string): void {
  writeLinearField("apiKey", apiKey);
  if (orchestrationConfig) orchestrationConfig.linearApiKey = apiKey;
}

/**
 * Remove the stored Linear key from `~/.dispatch/config.json` and from the held config.
 *
 * @remarks Deletes only `sources.linear.apiKey` and a legacy flat `linearApiKey`, carrying every
 * other key (the Linear filters included) forward verbatim at mode 0600. A file with no stored key
 * is left byte-identical, so a repeated disconnect writes nothing. The held config keeps its typed
 * empty state (`""`), which the registry reads as keyless on the next rebuild.
 */
export function clearLinearApiKey(): void {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  let parsed: Record<string, unknown>;
  try {
    const p = JSON.parse(raw) as unknown;
    if (typeof p !== "object" || p === null || Array.isArray(p)) {
      throw new Error("not an object");
    }
    parsed = p as Record<string, unknown>;
  } catch (err) {
    const pos = /position (\d+)/.exec((err as Error).message)?.[1];
    throw new Error(
      `config at ${CONFIG_PATH} is not valid JSON${pos ? ` (near position ${pos})` : ""}`,
      { cause: err },
    );
  }

  const sources =
    typeof parsed.sources === "object" &&
    parsed.sources !== null &&
    !Array.isArray(parsed.sources)
      ? (parsed.sources as Record<string, unknown>)
      : {};
  const linear =
    typeof sources.linear === "object" &&
    sources.linear !== null &&
    !Array.isArray(sources.linear)
      ? (sources.linear as Record<string, unknown>)
      : null;

  if ((linear && "apiKey" in linear) || "linearApiKey" in parsed) {
    const next: Record<string, unknown> = { ...parsed };
    delete next.linearApiKey;
    if (linear) {
      const nextLinear = { ...linear };
      delete nextLinear.apiKey;
      next.sources = { ...sources, linear: nextLinear };
    }
    writeFileAtomic.sync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", {
      mode: 0o600,
    });
    fs.chmodSync(CONFIG_PATH, 0o600);
  }

  if (orchestrationConfig) {
    orchestrationConfig.linearApiKey = "";
    if (orchestrationConfig.sources?.linear) {
      orchestrationConfig.sources.linear.apiKey = "";
    }
  }
}

type SourceBlocks = NonNullable<Config["sources"]>;

/**
 * Patch one `sources.<id>` block in `~/.dispatch/config.json` and in the held config.
 *
 * @remarks Every other top-level key and every other source block, including the Linear key, is
 * carried forward verbatim; the write is atomic at mode 0600 like the other writers here.
 */
export function patchSourceConfig<K extends keyof SourceBlocks>(
  id: K,
  patch: Partial<NonNullable<SourceBlocks[K]>>,
): void {
  const parsed = readConfigObject();
  const priorSources =
    typeof parsed.sources === "object" &&
    parsed.sources !== null &&
    !Array.isArray(parsed.sources)
      ? (parsed.sources as Record<string, unknown>)
      : {};
  const prior = priorSources[id];
  const priorBlock =
    typeof prior === "object" && prior !== null && !Array.isArray(prior)
      ? (prior as Record<string, unknown>)
      : {};
  const next = {
    ...parsed,
    sources: { ...priorSources, [id]: { ...priorBlock, ...patch } },
  };
  writeFileAtomic.sync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", {
    mode: 0o600,
  });
  fs.chmodSync(CONFIG_PATH, 0o600);
  if (orchestrationConfig) {
    const sources: SourceBlocks = orchestrationConfig.sources ?? {};
    sources[id] = { ...sources[id], ...patch };
    orchestrationConfig.sources = sources;
  }
}

/**
 * Read `~/.dispatch/config.json` as a JSON object.
 *
 * @remarks A parse failure reports the byte position only, never the parser message, which embeds
 * a snippet of the file and so can carry the API key.
 */
function readConfigObject(): Record<string, unknown> {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  let parsed: Record<string, unknown>;
  try {
    const p = JSON.parse(raw) as unknown;
    if (typeof p !== "object" || p === null || Array.isArray(p)) {
      throw new Error("not an object");
    }
    parsed = p as Record<string, unknown>;
  } catch (err) {
    const pos = /position (\d+)/.exec((err as Error).message)?.[1];
    throw new Error(
      `config at ${CONFIG_PATH} is not valid JSON${pos ? ` (near position ${pos})` : ""}`,
      { cause: err },
    );
  }
  return parsed;
}

/**
 * Read `~/.dispatch/config.json`, merge the flat top-level keys in `patch`, and write it back
 * atomically at mode 0600, mutating the in-memory config the same way so the change is live.
 * @remarks Shared by every flat-key writer below; nested `sources` writers keep their own merge.
 */
function patchConfig(patch: Partial<Config>): void {
  const next = { ...readConfigObject(), ...patch };

  writeFileAtomic.sync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", {
    mode: 0o600,
  });
  fs.chmodSync(CONFIG_PATH, 0o600);

  if (orchestrationConfig) {
    Object.assign(orchestrationConfig, patch);
  }
}

/**
 * Persist the remembered kickoff-picker default to `~/.dispatch/config.json` and make it live
 * immediately.
 *
 * @remarks Called only from `start-session.ts` after a start saga succeeds with an explicitly
 * chosen, already-validated playbook name — never from the route layer, so an unvalidated
 * client string can never reach disk. Simpler than {@link updateLinearApiKey}: `lastUsedPlaybook`
 * is a flat top-level key with no nested object to preserve. Same atomic-write-at-0600 + in-memory
 * mutation discipline as the other writers in this file.
 */
export function updateLastUsedPlaybook(name: string): void {
  patchConfig({ lastUsedPlaybook: name });
}

/**
 * Persist the sessions folder of the default board to `~/.dispatch/config.json` and make it live.
 *
 * @remarks The `PATCH /api/boards/LOCAL` service calls this only after it checked that the folder
 * exists. The next session start reads the held config, so no restart is needed.
 */
export function updateWorkspaceRoot(workspaceRoot: string): void {
  patchConfig({ workspaceRoot });
}

/**
 * Persist the cleanup delay (`LIFE-04`) to `~/.dispatch/config.json` and make it live immediately.
 *
 * @remarks Called only from the validated `PUT /config/cleanup-delay` route, which has already
 * rejected a non-integer or out-of-range value with 400 — this function never re-validates.
 * Flat top-level key, same shape as {@link updateLastUsedPlaybook}: no nested object to preserve.
 * Every other top-level key survives verbatim.
 */
export function updateCleanupDelayDays(days: number): void {
  patchConfig({ cleanupDelayDays: days });
}

/**
 * Persist the archive retention window (LOCAL-17) to `~/.dispatch/config.json` and make it live
 * immediately; called only from the validated `PUT /config/archive-retention` route.
 */
export function updateArchiveRetentionDays(days: number): void {
  patchConfig({ archiveRetentionDays: days });
}

/**
 * Persist the `claude` launch arguments (Settings ▸ Models) to `~/.dispatch/config.json` and make
 * them live immediately.
 *
 * @remarks Called only from the validated `PUT /config/claude-args` route. Flat top-level key,
 * same shape as {@link updateLastUsedPlaybook}: no nested object to preserve, every other
 * top-level key survives verbatim. The next session start/resume/restart reads the mutated
 * in-memory `orchestrationConfig` directly (`services/orchestration/steps.ts`,
 * `services/orchestration/resume-session.ts`) — no restart required.
 */
export function updateClaudeArgs(args: string): void {
  patchConfig({ claudeArgs: args });
}

/**
 * Persist the terminal appearance (Settings ▸ Terminal) to `~/.dispatch/config.json` and make it
 * live for the next `GET /api/config/terminal` read.
 * @remarks Called only from the validated `PUT /config/terminal` route; the whole object is
 * replaced, never merged, so a stale field can never survive a save.
 */
export function updateTerminalAppearance(appearance: TerminalAppearance): void {
  patchConfig({ terminal: appearance });
}

/**
 * Record that the setup wizard was closed so it never opens on its own again.
 *
 * @remarks Idempotent: every close path in the wizard calls it, and a repeat writes the same flag.
 */
export function markOnboardingDone(): void {
  patchConfig({ onboardingDone: true });
}

/**
 * Persist the About you profile (Settings ▸ About you) and make it live.
 *
 * @remarks Called only from the validated `PUT /config/profile` route. An empty profile is stored
 * as an absent key, because JSON serialization drops the undefined value.
 */
export function updateProfile(profile: UserProfile): void {
  patchConfig({
    profile: Object.keys(profile).length > 0 ? profile : undefined,
  });
}

/**
 * Read the chain settings (Settings ▸ Accounts), each absent key resolved to its default.
 */
export function getClaudeAccountsSettings(): ClaudeAccountsSettings {
  return {
    ...DEFAULT_CLAUDE_ACCOUNTS_SETTINGS,
    ...orchestrationConfig?.claudeAccounts,
  };
}

/**
 * Persist chain settings under the `claudeAccounts` key and make them live immediately.
 *
 * @remarks The merge starts from the loaded block, which `loadConfig` already type filtered, so a
 * wrong-typed key on disk never becomes live. The caller validates the ranges.
 */
export function updateClaudeAccountsSettings(
  patch: Partial<ClaudeAccountsSettings>,
): void {
  if (Object.keys(patch).length === 0) return;
  patchConfig({
    claudeAccounts: { ...orchestrationConfig?.claudeAccounts, ...patch },
  });
}

/**
 * Persist the active Claude account id (Settings ▸ Accounts, header switcher) and make it live for
 * the next session start.
 *
 * @remarks Same flat top-level shape as {@link updateClaudeArgs}. `default` is stored as an
 * absent key so an un-migrated config and a reset-to-default config are byte-identical. The
 * caller has already checked the id exists in the registry; this function never validates it.
 */
export function updateActiveClaudeAccountId(id: string): void {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  let parsed: Record<string, unknown>;
  try {
    const p = JSON.parse(raw) as unknown;
    if (typeof p !== "object" || p === null || Array.isArray(p)) {
      throw new Error("not an object");
    }
    parsed = p as Record<string, unknown>;
  } catch (err) {
    const pos = /position (\d+)/.exec((err as Error).message)?.[1];
    throw new Error(
      `config at ${CONFIG_PATH} is not valid JSON${pos ? ` (near position ${pos})` : ""}`,
      { cause: err },
    );
  }

  const next = { ...parsed };
  delete next.activeClaudeAccountId;
  if (id !== DEFAULT_CLAUDE_ACCOUNT_ID) {
    next.activeClaudeAccountId = id;
  }

  writeFileAtomic.sync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", {
    mode: 0o600,
  });
  fs.chmodSync(CONFIG_PATH, 0o600);

  if (orchestrationConfig) {
    if (id === DEFAULT_CLAUDE_ACCOUNT_ID) {
      delete orchestrationConfig.activeClaudeAccountId;
    } else {
      orchestrationConfig.activeClaudeAccountId = id;
    }
  }
}

/**
 * Persist whether an item source may poll, and make it live for the next registry rebuild.
 *
 * @remarks Only `sources.<id>.enabled` changes; every other key, including the rest of that source's
 * block, is carried verbatim. The connection routes are the only callers.
 */
export function setSourceEnabled(
  sourceId: ItemSourceId,
  enabled: boolean,
): void {
  patchSourceBlock(sourceId, { enabled });
}

/**
 * Persist the Slack channels to poll.
 *
 * @remarks Only `sources.slack.channels` changes; the caller has already validated the list.
 */
export function setSlackChannels(channels: SlackChannel[]): void {
  patchSourceBlock("slack", { channels });
}

/**
 * Persist the Slack mode and the Slack switch.
 *
 * @remarks Only the keys present in `patch` change; the caller has already validated them.
 */
export function setSlackMcpSettings(patch: {
  mode?: SlackMode;
  enabled?: boolean;
}): void {
  patchSourceBlock("slack", patch);
}

/**
 * Merge fields into one item source's config block on disk and in the held config.
 *
 * @remarks Atomic write at mode 0600; every other key in the file and in the block is carried verbatim.
 */
function patchSourceBlock(
  sourceId: ItemSourceId,
  patch: { enabled?: boolean; channels?: SlackChannel[]; mode?: SlackMode },
): void {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  let parsed: Record<string, unknown>;
  try {
    const p = JSON.parse(raw) as unknown;
    if (typeof p !== "object" || p === null || Array.isArray(p)) {
      throw new Error("not an object");
    }
    parsed = p as Record<string, unknown>;
  } catch (err) {
    const pos = /position (\d+)/.exec((err as Error).message)?.[1];
    throw new Error(
      `config at ${CONFIG_PATH} is not valid JSON${pos ? ` (near position ${pos})` : ""}`,
      { cause: err },
    );
  }

  const sources =
    typeof parsed.sources === "object" &&
    parsed.sources !== null &&
    !Array.isArray(parsed.sources)
      ? (parsed.sources as Record<string, unknown>)
      : {};
  const prior =
    typeof sources[sourceId] === "object" &&
    sources[sourceId] !== null &&
    !Array.isArray(sources[sourceId])
      ? (sources[sourceId] as Record<string, unknown>)
      : {};

  const next = {
    ...parsed,
    sources: { ...sources, [sourceId]: { ...prior, ...patch } },
  };
  writeFileAtomic.sync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", {
    mode: 0o600,
  });
  fs.chmodSync(CONFIG_PATH, 0o600);

  if (orchestrationConfig) {
    orchestrationConfig.sources = {
      ...orchestrationConfig.sources,
      [sourceId]: { ...orchestrationConfig.sources?.[sourceId], ...patch },
    };
  }
}

/**
 * The Slack mode: the configured one, else `token` when the Vault holds a Slack token, else `mcp`.
 *
 * @remarks An absent mode resolves on each call and is never written, so a transient Vault read pins nothing.
 */
export async function slackMode(): Promise<SlackMode> {
  const configured = getOrchestrationConfig()?.sources?.slack?.mode;
  if (configured === "mcp" || configured === "token") return configured;
  return resolveSlackMode(undefined, (await resolveSlackToken()) !== null);
}
