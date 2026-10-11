import writeFileAtomic from "write-file-atomic";
import {
  CROSS_SESSION_INBOUND_VALUES,
  type CrossSessionInbound,
} from "../../../shared/types.js";
import {
  HOOK_SCRIPT_PATH,
  HOOK_SETTINGS_PATH,
  VAULT_GUARD_PATH,
  VAULT_VALUES_PATH,
  hookSettingsPath,
} from "./paths.js";

export const PAUSE_TOOL_NAMES = new Set(["AskUserQuestion", "ExitPlanMode"]);

/**
 * Build the `--settings` layer for one inbound value: status hooks, vault deny rule, Bash guard.
 *
 * @remarks The `PreToolUse` pause matcher derives from {@link PAUSE_TOOL_NAMES}, so the enter and
 * flip-back branches in hook-events cannot drift from it. The deny rule covers the Read tool and
 * the guard covers Bash (T-105-03, T-105-06). The rule keeps a double leading slash, because
 * `VAULT_VALUES_PATH` carries one and a single slash is a silent no-op on the installed CLI.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export function hookSettingsJson(inbound: CrossSessionInbound): string {
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
  }
  await writeFileAtomic(HOOK_SETTINGS_PATH, hookSettingsJson(configValue), {
    mode: 0o644,
  });
}
