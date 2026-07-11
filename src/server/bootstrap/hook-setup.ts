import fsp from "node:fs/promises";
import writeFileAtomic from "write-file-atomic";
import { run } from "../adapters/exec.js";
import { resolveBinaryPath } from "../adapters/resolve-binary.js";
import {
  DISPATCH_DIR,
  HOOK_SCRIPT_PATH,
  HOOK_SETTINGS_PATH,
} from "../services/paths.js";

/**
 * Lowest claude CLI version whose hook payload contract was live-verified (Stop carries
 * `last_assistant_message`, per-entry timeouts enforced). Below this floor injection is skipped
 * entirely and the pane watcher carries status alone.
 */
const HOOKS_FLOOR: [number, number, number] = [2, 1, 207];

/**
 * Body of `~/.dispatch/hook.sh`. Static — zero session-specific bytes, so there is no JSON/shell
 * escaping surface; all dynamic values ride `DISPATCH_*` env set per session via tmux. The three
 * env guards make manual claude sessions no-op instantly; curl's `--max-time 1` plus the
 * unconditional `exit 0` keep the script from ever blocking or influencing a turn (exit 2 would
 * block Stop and erase the typed prompt on UserPromptSubmit).
 */
const HOOK_SCRIPT = `#!/bin/sh
[ -n "$DISPATCH_HOOK_PORT" ] || exit 0
[ -n "$DISPATCH_HOOK_TOKEN" ] || exit 0
[ -n "$DISPATCH_CARD_ID" ] || exit 0
curl --silent --output /dev/null --max-time 1 \\
  -H "content-type: application/json" \\
  -H "x-dispatch-token: $DISPATCH_HOOK_TOKEN" \\
  --data-binary @- \\
  "http://127.0.0.1:\${DISPATCH_HOOK_PORT}/api/hook/claude" || true
exit 0
`;

/**
 * The `--settings` layer content: exactly Stop + UserPromptSubmit + PostToolUse, each with an
 * explicit per-entry timeout (the CLI default is 600s and a timeout-less slow hook blocks the
 * turn for its full runtime). PostToolUse feeds the unseen-activity dot via hook-events' throttled
 * `outputChangedAt` stamp. SessionStart remains absent — no consumer exists.
 */
function hookSettingsJson(): string {
  const entry = [
    { hooks: [{ type: "command", command: HOOK_SCRIPT_PATH, timeout: 5 }] },
  ];
  const settings = {
    hooks: { Stop: entry, UserPromptSubmit: entry, PostToolUse: entry },
  };
  return JSON.stringify(settings, null, 2) + "\n";
}

/**
 * Idempotently (re)write both `~/.dispatch` hook artifacts at boot. Regenerating every boot
 * self-heals manual edits or moves and keeps the script path in the settings current. Atomic
 * writes via write-file-atomic (repo standard); the script must be executable for claude to
 * spawn it.
 */
export async function installHookArtifacts(): Promise<void> {
  await fsp.mkdir(DISPATCH_DIR, { recursive: true, mode: 0o700 });
  await writeFileAtomic(HOOK_SCRIPT_PATH, HOOK_SCRIPT, { mode: 0o755 });
  await fsp.chmod(HOOK_SCRIPT_PATH, 0o755);
  await writeFileAtomic(HOOK_SETTINGS_PATH, hookSettingsJson(), {
    mode: 0o644,
  });
}

/**
 * Whether the installed claude CLI is at or above the verified hooks-contract floor, plus the
 * detected version string when one was parsed (null when the CLI is unresolvable, unparseable,
 * or hooks are env-disabled) so bootstrap can name the exact CLI in its `statusChannel: "hooks"`
 * consequence warning.
 */
export interface HooksCapability {
  capable: boolean;
  version: string | null;
}

/**
 * Capable when the installed claude CLI is at or above the verified hooks-contract floor. Below
 * floor, unparseable output, or any exec failure degrades to incapable with one content-free
 * warning — never a startup failure, because an incapable CLI just means sessions launch exactly
 * as before and the untouched watcher carries status. Setting `DISPATCH_HOOKS_DISABLED=1` on the
 * backend process forces incapable — the deterministic hook-silent simulation for smoke runs and
 * the standing below-floor-CLI stand-in (env-toggle precedent: `AK_WATCH_DEBUG`).
 */
export async function checkHooksCapability(): Promise<HooksCapability> {
  if (process.env.DISPATCH_HOOKS_DISABLED === "1") {
    console.warn("[hooks] disabled via DISPATCH_HOOKS_DISABLED");
    return { capable: false, version: null };
  }
  try {
    const claudePath = await resolveBinaryPath("claude");
    if (!claudePath) {
      console.warn("[hooks] claude not resolvable — hook injection disabled");
      return { capable: false, version: null };
    }
    const { stdout } = await run(claudePath, ["--version"]);
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(stdout);
    if (!m) {
      console.warn("[hooks] claude version unparseable — injection disabled");
      return { capable: false, version: null };
    }
    const version = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let i = 0; i < 3; i++) {
      if (version[i] > HOOKS_FLOOR[i]) {
        return { capable: true, version: m[0] };
      }
      if (version[i] < HOOKS_FLOOR[i]) {
        console.warn("[hooks] claude below hooks floor — injection disabled");
        return { capable: false, version: m[0] };
      }
    }
    return { capable: true, version: m[0] };
  } catch {
    console.warn("[hooks] claude version check failed — injection disabled");
    return { capable: false, version: null };
  }
}
