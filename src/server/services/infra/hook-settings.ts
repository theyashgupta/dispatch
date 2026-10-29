import fsp from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import {
  CROSS_SESSION_INBOUND_VALUES,
  type CrossSessionInbound,
} from "../../../shared/types.js";
import {
  CLAUDE_HOME_DIR,
  HOOK_SCRIPT_PATH,
  HOOK_SETTINGS_PATH,
  VAULT_GUARD_PATH,
  VAULT_VALUES_PATH,
  hookSettingsPath,
} from "./paths.js";

export const PAUSE_TOOL_NAMES = new Set(["AskUserQuestion", "ExitPlanMode"]);

const LOOP_SETTINGS = { idleCompaction: false, promptSuggestionEnabled: false };

/**
 * Build the `--settings` layer for one inbound value: status hooks, vault deny rule, Bash guard.
 *
 * @remarks The `PreToolUse` pause matcher derives from {@link PAUSE_TOOL_NAMES}, so the enter and
 * flip-back branches in hook-events cannot drift from it. The deny rule covers the Read tool and
 * the guard covers Bash (T-105-03, T-105-06). The rule keeps a double leading slash, because
 * `VAULT_VALUES_PATH` carries one and a single slash is a silent no-op on the installed CLI.
 * A loop file sets `idleCompaction` and `promptSuggestionEnabled` to false, because a compaction
 * while idle froze loop sessions and a suggested `/ship` line sat unsent in a loop prompt box
 * (LOCAL-184); the orchestrator file leaves both keys out.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export function hookSettingsJson(
  inbound: CrossSessionInbound,
  orchestrator = false,
): string {
  const entry = [
    { hooks: [{ type: "command", command: HOOK_SCRIPT_PATH, timeout: 5 }] },
  ];
  const settings = {
    permissions: {
      deny: [`Read(/${VAULT_VALUES_PATH})`],
    },
    crossSessionInbound: inbound,
    hooks: {
      SessionStart: entry,
      Stop: entry,
      StopFailure: entry,
      UserPromptSubmit: entry,
      PostToolUse: entry,
      PostToolUseFailure: entry,
      PreToolUse: [
        { matcher: [...PAUSE_TOOL_NAMES].join("|"), hooks: entry[0].hooks },
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: VAULT_GUARD_PATH, timeout: 5 }],
        },
      ],
    },
    ...(orchestrator ? {} : LOOP_SETTINGS),
  };
  return JSON.stringify(settings, null, 2) + "\n";
}

/**
 * Write one settings file per inbound value, plus the default file holding the config value.
 *
 * @remarks A launch picks the file of its resolved value, so the default file only serves
 * callers that do not resolve one.
 */
export async function writeHookSettings(
  configValue: CrossSessionInbound,
): Promise<void> {
  for (const value of CROSS_SESSION_INBOUND_VALUES) {
    await writeFileAtomic(hookSettingsPath(value), hookSettingsJson(value), {
      mode: 0o644,
    });
    await writeFileAtomic(
      hookSettingsPath(value, true),
      hookSettingsJson(value, true),
      { mode: 0o644 },
    );
  }
  await writeFileAtomic(HOOK_SETTINGS_PATH, hookSettingsJson(configValue), {
    mode: 0o644,
  });
}

/**
 * Merge the loop settings into the `settings.json` of a Claude config dir and keep its other keys.
 *
 * @remarks A session start calls it for the account dir it launches on, because a new account dir
 * did not get the boot write (LOCAL-198). An account dir links `settings.json` to the home file and
 * `write-file-atomic` follows the link, so the link stays. A file that does not parse as an object
 * stays as it is, and the function never throws, so a launch never fails on it.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
export async function writeLoopSettings(
  configDir = CLAUDE_HOME_DIR,
): Promise<void> {
  const file = path.join(configDir, "settings.json");
  let current: unknown = {};
  try {
    current = JSON.parse(await fsp.readFile(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return;
  }
  if (typeof current !== "object" || current === null || Array.isArray(current))
    return;
  const settings = current as Record<string, unknown>;
  if (Object.entries(LOOP_SETTINGS).every(([k, v]) => settings[k] === v))
    return;
  await writeFileAtomic(
    file,
    JSON.stringify({ ...settings, ...LOOP_SETTINGS }, null, 2) + "\n",
  ).catch(() => undefined);
}
