import fsp from "node:fs/promises";
import writeFileAtomic from "write-file-atomic";
import { run } from "../adapters/exec.js";
import { resolveBinaryPath } from "../adapters/resolve-binary.js";
import { PAUSE_TOOL_NAMES } from "../services/domain/hook-events.js";
import {
  DISPATCH_DIR,
  HOOK_SCRIPT_PATH,
  HOOK_SETTINGS_PATH,
  VAULT_RUN_PATH,
  VAULT_GUARD_PATH,
  VAULT_VALUES_PATH,
} from "../services/infra/paths.js";

/**
 * Lowest claude CLI version whose hook payload contract was live-verified (Stop carries
 * `last_assistant_message`, per-entry timeouts enforced, a matched `PreToolUse` entry reliably
 * delivers `tool_name`/`tool_use_id`). Below this floor injection is skipped entirely and the
 * pane watcher carries status alone. 48-IN-01: the PreToolUse-matcher/`tool_use_id` surface was
 * live-verified on CLI 2.1.212 (48-DIAGNOSIS.md); re-verified against 2.1.214 in Phase 57
 * (57-01-SUMMARY.md) with no contract drift observed.
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
 * Body of `~/.dispatch/vault-run`, POSIX sh, generated once at module load from the two absolute
 * vault path constants, never a tilde and never a HOME expansion, matching `HOOK_SCRIPT_PATH`'s
 * own doc-comment rule. Ports the proven `~/.claude/scripts/with-env.sh` shape: refuse before ever
 * sourcing, source the values file wholesale (`vault.ts#quoteEnvValue` already POSIX-quotes every
 * value so no escaping happens here), then unset every name the values file itself carries that was
 * not requested. The narrowing enumerates the sourced file (`VALUES`), never `schema.keys`, so a key
 * present in `values.env` but missing from a stale `schema.keys` (the store's documented crash
 * window) is still unset rather than leaked (105-CR-03).
 * The refusal ordering IS the security property: nothing is sourced until every refusal class has
 * been decided. Six dumper basenames (env/printenv/set/export/declare/typeset) are refused, one
 * more than the five-name prototype, since `typeset` is a `declare` synonym and refusing one while
 * allowing the other would be a gap. `SEP` is built from two single-hyphen assignments rather than
 * written as one literal token, so the file's own end-of-options separator never appears doubled in
 * this module's source text.
 * @remarks Ratified as `T-105-01` (exact-key injection, invoking shell never mutated) and
 * `T-105-02` (the refusal-before-sourcing gate), see docs/ARCHITECTURE.md#security-threat-model.
 */
const VAULT_RUN_SCRIPT = `#!/bin/sh
# vault-run: inject exactly the requested Dispatch vault keys into a wrapped
# command's environment, then exec it. Regenerated every boot; never hand-edit.
# Usage: vault-run --keys NAME[,NAME...] <the POSIX end-of-options separator> <command> [args...]

VALUES="${VAULT_VALUES_PATH}"
OLD_IFS="$IFS"
DASH="-"
SEP="$DASH$DASH"

usage() {
  echo "vault-run: usage error, see Settings, Vault for the exact syntax" >&2
  exit 64
}

[ "$#" -ge 4 ] || usage
[ "$1" = "--keys" ] || usage
KEYS="$2"
[ "$3" = "$SEP" ] || usage
[ -n "$KEYS" ] || usage
shift 3

IFS=,
for k in $KEYS; do
  case "$k" in
    [A-Z_]*) ;;
    *) IFS="$OLD_IFS"; usage ;;
  esac
  case "$k" in
    *[!A-Z0-9_]*) IFS="$OLD_IFS"; usage ;;
  esac
done
IFS="$OLD_IFS"

CMD_BASENAME="\${1##*/}"
case "$CMD_BASENAME" in
  env|printenv|set|export|declare|typeset)
    echo "vault-run: refusing to dump the environment, see Settings, Vault" >&2
    exit 2
    ;;
esac

[ -f "$VALUES" ] || {
  echo "vault-run: no vault configured yet, see Settings, Vault" >&2
  exit 1
}

IFS=,
for k in $KEYS; do
  if ! grep -q "^$k=" "$VALUES"; then
    IFS="$OLD_IFS"
    echo "vault-run: key $k is not set, see Settings, Vault" >&2
    exit 3
  fi
done
IFS="$OLD_IFS"

key_requested() {
  _want="$1"
  IFS=,
  for k in $KEYS; do
    if [ "$k" = "$_want" ]; then
      IFS="$OLD_IFS"
      return 0
    fi
  done
  IFS="$OLD_IFS"
  return 1
}

set -a
. "$VALUES"
set +a

while IFS= read -r line; do
  case "$line" in
    ""|"#"*) continue ;;
  esac
  name="\${line%%=*}"
  case "$name" in
    [A-Z_]*) ;;
    *) continue ;;
  esac
  case "$name" in
    *[!A-Z0-9_]*) continue ;;
  esac
  if ! key_requested "$name"; then
    unset "$name"
  fi
done < "$VALUES"

exec "$@"
`;

/**
 * Body of `~/.dispatch/vault-guard.mjs`, Node ESM, generated once at module load from
 * `VAULT_VALUES_PATH`, the absolute path baked in as a literal so the generated file itself never
 * expands a home directory or shell variable. Ports `~/.claude/hooks/env-vault-guard.py`'s proven
 * deny classes (read-out, copy/exfiltration, raw source or dot-sourcing) plus its file-management
 * allowlist, with one addition beyond the prototype: a runner-mediated-dump check, since
 * `vault-run`'s `--keys NAME[,NAME...]` flag plus its own end-of-options separator has no
 * equivalent in the prototype's simpler positional `with-env.sh env` form. Node, not Python:
 * `pty-shim.py` is Python because it interposes on PTY bytes and carries its own boot-time
 * interpreter probe; this hook only parses JSON and runs regexes, so a second interpreter
 * dependency would add an unnecessary failure mode.
 *
 * The schema file is deliberately outside every check here: the kickoff block tells every session
 * to read it directly, and it never carries a value, only names and purposes.
 *
 * Tool-coverage boundary, from plan 01's recorded observation: the generated settings'
 * `permissions.deny` rule governs the Read tool and a Bash command that places the literal
 * absolute values path as an argument. This guard governs only the Bash tool, for command shapes
 * a literal-path deny rule cannot see, an indirect reference built from a variable, a relative or
 * tilde-written path, or another reader entirely. The two layers are not two spellings of one
 * block; they cover two different tools.
 * @remarks Ratified as `T-105-04`, the LOAD-BEARING enforcement layer for VLT-08 on the currently
 * installed CLI, see docs/ARCHITECTURE.md#security-threat-model.
 */
const VAULT_GUARD_SCRIPT = `#!/usr/bin/env node
import { basename, dirname } from "node:path";
import { writeSync } from "node:fs";
import { text } from "node:stream/consumers";

const VALUES_PATH = ${JSON.stringify(VAULT_VALUES_PATH)};
const VALUES_MARKERS = [VALUES_PATH, "vault/values.env"];
const VALUES_BASENAME = basename(VALUES_PATH).toLowerCase();
const VAULT_DIRNAME = basename(dirname(VALUES_PATH)).toLowerCase();

const READ_OUT =
  /\\b(cat|head|tail|less|more|most|grep|rg|egrep|fgrep|sed|awk|od|xxd|hexdump|strings|base64|uuencode|sort|uniq|wc|diff|cmp|cut|tr|rev|nl|pr|fold|column|paste|join|split|csplit|dd|tee|python3?|node|ruby|perl|php)\\b/;
const COPY_OUT =
  /\\b(cp|mv|rsync|scp|install|ln|zip|tar|gzip|curl|wget|nc|mail)\\b/;
const RAW_SOURCE = /(\\bsource\\b|(^|[;&|]\\s*)\\.\\s)/;
const ALLOWED_ON_VALUES =
  /^\\s*(open\\b|code\\b|codium\\b|subl\\b|ls\\b|stat\\b|chmod\\b|touch\\b|mkdir\\b|file\\b|du\\b)/;
const RUNNER_DUMPERS = new Set([
  "env",
  "printenv",
  "set",
  "export",
  "declare",
  "typeset",
]);
const RUNNER_LAUNCHERS = new Set([
  "time",
  "env",
  "sudo",
  "nice",
  "nohup",
  "command",
]);
const DASH = "-";
const SEP = DASH + DASH;

/**
 * Whether 'cmd' contains a shell command separator or substitution, so an allowlisted head verb
 * cannot chain a second, unvetted operation on the same values path (105-CR-01). A single
 * '&'/'|' catches its doubled form too; broader is safe because the only effect is to decline the
 * single-op allowlist and fall through to the deny classes.
 */
function hasChaining(cmd) {
  return (
    cmd.includes(";") ||
    cmd.includes("&") ||
    cmd.includes("|") ||
    cmd.includes("\\n") ||
    cmd.includes("\`") ||
    cmd.includes("$(")
  );
}

function deny(reason) {
  writeSync(
    1,
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function tokenize(cmd) {
  return cmd.split(/\\s+/).filter((t) => t.length > 0);
}

function findRunnerIndex(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (basename(tokens[i]) === "vault-run") return i;
  }
  return -1;
}

/**
 * Whether the vault-run token at 'i' sits in command-head position: either first, or preceded
 * only by known launchers (time/env/sudo/...). A non-head occurrence is vault-run named as an
 * argument (ls/chmod/cat on the runner file), not an invocation, so it must not be judged as a
 * dumper wrapper (105-WR-01).
 */
function isRunnerHead(tokens, i) {
  for (let j = 0; j < i; j++) {
    if (!RUNNER_LAUNCHERS.has(basename(tokens[j]))) return false;
  }
  return true;
}

/**
 * Whether 'tokens' invoke vault-run wrapping a dumper basename, or invoke it in a shape too
 * ambiguous to resolve cleanly. A vault-run token that is not the command head is treated as a
 * mere argument and falls through to the normal values-reference checks, not denied as a dump.
 *
 * @remarks A false deny here is safe; a false allow is not, so any unresolved invocation shape
 * denies too.
 */
function isRunnerMediatedDump(tokens) {
  const i = findRunnerIndex(tokens);
  if (i === -1) return false;
  if (!isRunnerHead(tokens, i)) return false;
  if (tokens[i + 1] !== "--keys") return true;
  if (tokens[i + 3] !== SEP) return true;
  const wrapped = tokens[i + 4];
  if (wrapped === undefined) return true;
  return RUNNER_DUMPERS.has(basename(wrapped));
}

/**
 * Whether any token's basename is the values file, compared case-insensitively so a case-variant
 * spelling on a case-insensitive volume (macOS APFS/HFS+) still counts as a reference (105-CR-02).
 */
function namesValuesFile(tokens) {
  return tokens.some((t) => basename(t).toLowerCase() === VALUES_BASENAME);
}

/**
 * Whether the command cd/pushd-es into the vault directory and then names the values basename,
 * the split-path shape the absolute-path and 'vault/values.env' substring markers miss
 * (105-CR-02).
 */
function entersVaultThenNamesValues(cmd, tokens) {
  const entersVault = tokens.some(
    (t, i) =>
      (t === "cd" || t === "pushd") &&
      tokens[i + 1] !== undefined &&
      basename(tokens[i + 1]).toLowerCase() === VAULT_DIRNAME,
  );
  return entersVault && cmd.toLowerCase().includes(VALUES_BASENAME);
}

let payload;
try {
  payload = JSON.parse(await text(process.stdin));
} catch {
  process.exit(0);
}

if (payload.tool_name !== "Bash") process.exit(0);
const cmd = payload.tool_input?.command ?? "";
if (!cmd) process.exit(0);

const tokens = tokenize(cmd);
if (isRunnerMediatedDump(tokens)) {
  deny(
    "vault-guard: vault-run must wrap a real command, never an environment dump " +
      "(env/printenv/set/export/declare/typeset). That would print every secret in the vault. " +
      "Run the actual command instead.",
  );
}

const lowerCmd = cmd.toLowerCase();
const referencesValues =
  VALUES_MARKERS.some((marker) => lowerCmd.includes(marker.toLowerCase())) ||
  namesValuesFile(tokens) ||
  entersVaultThenNamesValues(cmd, tokens);
if (!referencesValues) process.exit(0);

if (ALLOWED_ON_VALUES.test(cmd.trim()) && !hasChaining(cmd)) process.exit(0);

if (findRunnerIndex(tokens) !== -1) {
  deny(
    "vault-guard: commands must not reference values.env directly, even alongside vault-run. " +
      "Use vault-run --keys NAME[,NAME...] to select values; it loads the vault internally, so " +
      "naming the path again is not needed.",
  );
}

if (READ_OUT.test(cmd) || COPY_OUT.test(cmd) || RAW_SOURCE.test(cmd)) {
  deny(
    "vault-guard: values.env is sealed. Its contents are never read, printed, copied, or sourced " +
      "directly. To use the variables, run vault-run --keys NAME[,NAME...], then the wrapped " +
      "command. To let the user edit the file, open Settings, Vault.",
  );
}

deny(
  "vault-guard: unrecognized operation on values.env. Allowed: vault-run to use the variables, " +
    "file management (ls/stat/chmod/open/code/file/du), or Settings, Vault to edit. Everything " +
    "else on this file is blocked.",
);
`;

/**
 * The `--settings` layer content: Stop + UserPromptSubmit + PostToolUse (unmatched, catch-all)
 * plus a matched `PreToolUse` entry whose matcher is derived from {@link PAUSE_TOOL_NAMES} —
 * the single source of truth shared with hook-events' enter/flip-back branches, so extending the
 * pause-tool set can never half-wire (a hardcoded matcher edited out of sync would leave the
 * catch-all PostToolUse flipping back on a tool the matcher never delivers). Claude Code matchers
 * accept regex alternation, and a single name degenerates to the exact string. Each entry carries
 * an explicit per-entry timeout (the CLI default is 600s and a timeout-less slow hook blocks the
 * turn for its full runtime). PostToolUse feeds the unseen-activity dot via hook-events' throttled
 * `outputChangedAt` stamp, AND (HOOK-03) carries the flip-back signal for a tool-mediated pause.
 * PreToolUse (HOOK-03) is the structural safety net for the same pause class: live-verified
 * (48-DIAGNOSIS.md) to fire reliably on the installed CLI, catching the pause regardless of
 * whether the agent follows the STATUS_PROTOCOL wording (kickoff.ts) that asks it to print a
 * marker line first. SessionStart remains absent, no consumer exists.
 *
 * The vault's `permissions.deny` rule and its second `PreToolUse` guard entry are two layers over
 * two different tools, not two spellings of the same block: the deny rule governs the Read tool
 * (and a Bash command that places the literal absolute values path as an argument), while the
 * guard governs the Bash tool for every command shape the deny rule cannot see. Both are enforced
 * by the CLI's own permission engine rather than by prompt engineering, and both are recorded able
 * to survive bypass-permissions mode, plan 01's eight-cell enforcement table (105-01-SUMMARY.md)
 * is the local evidence. The deny entry's `Read(/${VAULT_VALUES_PATH})` interpolation reads as a
 * single extra leading slash, but `VAULT_VALUES_PATH` already carries its own, so the rendered
 * rule ends up with the double-leading-slash form the same spike proved load-bearing: a single
 * total slash was a silent no-op on the installed CLI. Both layers ride this `--settings` flag, so
 * a launch below the hooks floor, under a forced pane status channel
 * (`runtime.statusChannel === "pane"`, see `steps.ts`'s `startClaude`), or with hooks
 * env-disabled carries neither layer, leaving the runner's own refusal gate as the session's only
 * remaining protection.
 * @remarks Ratified as `T-105-03` (the deny rule, ACCEPTED best-effort defense-in-depth, not
 * confirmed to hold alone on the currently installed CLI) and `T-105-06` (the below-floor degrade
 * that carries neither layer), see docs/ARCHITECTURE.md#security-threat-model.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
function hookSettingsJson(): string {
  const entry = [
    { hooks: [{ type: "command", command: HOOK_SCRIPT_PATH, timeout: 5 }] },
  ];
  const settings = {
    permissions: {
      deny: [`Read(/${VAULT_VALUES_PATH})`],
    },
    hooks: {
      Stop: entry,
      UserPromptSubmit: entry,
      PostToolUse: entry,
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
 * Idempotently (re)write every `~/.dispatch` boot artifact: the hook script, the vault-run
 * runner, the vault-guard PreToolUse hook, and the settings JSON. Regenerating every boot
 * self-heals manual edits or moves and keeps the script paths in the settings current. Atomic
 * writes via write-file-atomic (repo standard); all three scripts must be executable for claude
 * to spawn them. `write-file-atomic`'s `mode` option is create-only, so each executable write is
 * followed by an explicit `chmod`.
 */
export async function installHookArtifacts(): Promise<void> {
  await fsp.mkdir(DISPATCH_DIR, { recursive: true, mode: 0o700 });
  await writeFileAtomic(HOOK_SCRIPT_PATH, HOOK_SCRIPT, { mode: 0o755 });
  await fsp.chmod(HOOK_SCRIPT_PATH, 0o755);
  await writeFileAtomic(VAULT_RUN_PATH, VAULT_RUN_SCRIPT, { mode: 0o755 });
  await fsp.chmod(VAULT_RUN_PATH, 0o755);
  await writeFileAtomic(VAULT_GUARD_PATH, VAULT_GUARD_SCRIPT, { mode: 0o755 });
  await fsp.chmod(VAULT_GUARD_PATH, 0o755);
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
